import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs-extra";
import { spawn } from "child_process";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const PUBLIC_DIR = path.join(process.cwd(), "public");
const RENDERS_DIR = path.join(process.cwd(), "renders");
const TEMP_DIR = path.join(process.cwd(), "temp");

// Ensure directories exist
fs.ensureDirSync(PUBLIC_DIR);
fs.ensureDirSync(RENDERS_DIR);
fs.ensureDirSync(TEMP_DIR);

// Serve static files
app.use("/public", express.static(PUBLIC_DIR));
app.use("/renders", express.static(RENDERS_DIR));

// 0. Force Download endpoint
app.get("/api/download", (req, res) => {
  const filename = req.query.filename as string;
  if (!filename) return res.status(400).send("Filename required");
  
  // Security: only allow files from renders or public
  const rendersPath = path.join(RENDERS_DIR, filename);
  const publicPath = path.join(PUBLIC_DIR, filename);
  
  if (fs.existsSync(rendersPath)) {
    return res.download(rendersPath);
  } else if (fs.existsSync(publicPath)) {
    return res.download(publicPath);
  } else {
    res.status(404).send("File not found");
  }
});

const getApiKey = (req: express.Request) => {
  const apiKey = req.headers["x-api-key"] || process.env.GEMINI_API_KEY;
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("Missing or invalid API Key");
  }
  return apiKey;
};

// 1. GET /api/list-voices
app.get("/api/list-voices", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const url = `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error?.message || "Failed to fetch voices");
    }

    const data = await response.json();
    const filteredVoices = (data.voices || [])
      .filter((v: any) => v.languageCodes.some((lc: string) => lc.startsWith("en-")))
      .map((v: any) => ({
        name: v.name,
        ssmlGender: v.ssmlGender,
        languageCodes: v.languageCodes
      }));
    
    res.json(filteredVoices);
  } catch (error: any) {
    if (error.message.includes("not been used") || error.message.includes("disabled") || error.message.includes("not found")) {
      const mockVoices = [
        { name: "en-US-Wavenet-A", ssmlGender: "FEMALE", languageCodes: ["en-US"] },
        { name: "en-US-Wavenet-B", ssmlGender: "MALE", languageCodes: ["en-US"] },
        { name: "en-GB-Wavenet-A", ssmlGender: "FEMALE", languageCodes: ["en-GB"] },
      ];
      return res.json({ 
        isMock: true, 
        voices: mockVoices,
        warning: "Google Cloud TTS API is disabled. Using sandbox voices." 
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// 2. POST /api/synthesize
app.post("/api/synthesize", async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { text, voiceName } = req.body;

    if (!text) return res.status(400).json({ error: "Text is required" });

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { name: voiceName || "en-US-Wavenet-A", languageCode: voiceName?.split('-').slice(0, 2).join('-') || "en-US" },
        audioConfig: { audioEncoding: "MP3" }
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      const message = errData.error?.message || "Synthesis failed";
      
      if (message.includes("not been used") || message.includes("disabled")) {
        return res.json({ 
          url: null, 
          isMock: true, 
          warning: "TTS API is disabled. Generating silent sequence." 
        });
      }
      throw new Error(message);
    }

    const data = await response.json();
    const audioBuffer = Buffer.from(data.audioContent, "base64");
    
    const filename = `tts-${Date.now()}.mp3`;
    const filepath = path.join(PUBLIC_DIR, filename);
    await fs.writeFile(filepath, audioBuffer);

    res.json({ url: `/public/${filename}`, filename });
  } catch (error: any) {
    console.error("TTS Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint for saving frontend-generated audio blobs
app.post("/api/save-audio", async (req, res) => {
  try {
    const { base64Data, format = "wav" } = req.body;
    if (!base64Data) return res.status(400).json({ error: "No audio data provided" });

    const buffer = Buffer.from(base64Data, "base64");
    const filename = `ext-audio-${Date.now()}.${format}`;
    const filepath = path.join(PUBLIC_DIR, filename);
    
    await fs.writeFile(filepath, buffer);
    res.json({ url: `/public/${filename}`, filename });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. POST /api/render
app.post("/api/render", async (req, res) => {
  try {
    const { inputProps } = req.body;
    if (!inputProps) return res.status(400).json({ error: "inputProps required" });

    const renderId = `render-${Date.now()}`;
    const outPath = path.join(RENDERS_DIR, `${renderId}.mp4`);
    const propsPath = path.join(TEMP_DIR, `${renderId}-props.json`);
    
    await fs.writeJson(propsPath, inputProps);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendStatus = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendStatus({ percent: 5, message: "Initializing render..." });

    // Use full path to npx or ensure it's in the environment
    const remotionProcess = spawn("npx", [
      "remotion", 
      "render", 
      "src/Root.tsx", 
      "MainVideo", 
      outPath,
      "--props", propsPath,
      "--overwrite"
    ]);

    remotionProcess.stdout.on("data", (data) => {
      const output = data.toString();
      // Look for render progress patterns
      const match = output.match(/(\d+)%/);
      if (match) {
        sendStatus({ percent: 10 + (parseInt(match[1]) * 0.85), message: `Rendering... ${match[1]}%` });
      }
    });

    remotionProcess.stderr.on("data", (data) => {
      console.warn(`Render debug: ${data.toString()}`);
    });

    remotionProcess.on("close", async (code) => {
      if (code === 0) {
        sendStatus({ percent: 100, message: "Render complete!", url: `/renders/${renderId}.mp4`, complete: true });
        
        // Cleanup temp files
        try {
          await fs.remove(propsPath);
        } catch (e) {}
      } else {
        sendStatus({ error: `Process exited with code ${code}`, complete: true });
      }
      res.end();
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
