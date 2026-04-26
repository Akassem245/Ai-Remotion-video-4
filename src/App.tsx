import { MyVideoProps, VisualEvent, MyVideo } from './Composition';
import { Play, Pause, RefreshCw, Terminal, CheckCircle2, Key, Wand2, Loader2, Sparkles, Download, Film, Type as TypeIcon, Upload, Zap, Volume2, Settings2, Mic2, AlertCircle, X } from 'lucide-react';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Player } from '@remotion/player';

const GEMINI_VOICES = [
  { name: 'Kore', label: 'Kore (Balanced)' },
  { name: 'Puck', label: 'Puck (Youthful)' },
  { name: 'Charon', label: 'Charon (Deep Mono)' },
  { name: 'Fenrir', label: 'Fenrir (Powerful)' },
  { name: 'Zephyr', label: 'Zephyr (Gentle)' }
];

export default function App() {
  const [apiKey, setApiKey] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [editableScript, setEditableScript] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  const [status, setStatus] = useState('Idle');
  const [isDrafting, setIsDrafting] = useState(false);
  const [isAssembling, setIsAssembling] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStatus, setRenderStatus] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoData, setVideoData] = useState<MyVideoProps | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('9:16');
  const [tone, setTone] = useState<'cinematic' | 'professional' | 'calm' | 'energetic'>('cinematic');
  const [draftedBackground, setDraftedBackground] = useState<string>('abstract-blue');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [customVideoUrl, setCustomVideoUrl] = useState<string | null>(null);
  const [imageAssets, setImageAssets] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const ai = useMemo(() => {
    const key = apiKey || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined);
    if (!key) return null;
    try {
      return new GoogleGenAI({ apiKey: key });
    } catch (e) {
      console.error("AI Init Error:", e);
      return null;
    }
  }, [apiKey]);

  const parseErrorMessage = (err: any): string => {
    try {
      // If the error message is a JSON string (common with 429/403 responses)
      if (err.message && err.message.startsWith('{')) {
        const parsed = JSON.parse(err.message);
        return parsed.error?.message || err.message;
      }
    } catch (e) {}
    return err.message || String(err);
  };

  const draftScript = async () => {
    if (!prompt) return;
    if (!ai) {
      setErrorMessage("يرجى إدخال مفتاح API في الحقل الموجود في الأعلى للمتابعة.\n(Please enter an API key in the field above to continue.)");
      return;
    }
    setIsDrafting(true);
    setErrorMessage(null);
    setEditableScript('');
    
    try {
      setStatus('Analyzing Prompt & Extracting Script...');
      const generation = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [{
          role: "user",
          parts: [{
            text: `ACT AS A SENIOR SCRIPTWRITER. 
            
            USER INPUT: "${prompt}"
            REQUESTED TONE: "${tone}"

            TASK: EXTRACT the core message and specific wording from the input and turn it into a 20-second script. 
            - If the user provided specific quotes, USE THEM.
            - STRICT: Preserve the input language (e.g. if prompt is Arabic, script MUST be Arabic).
            - Match the tone to "${tone}" (cinematic, professional, calm, or energetic).
            - Don't force aggression if the tone is calm/professional.
            - Ensure the language is natural and flows well for speech.
            
            Return JSON:
            {
              "script": "The extracted and refined voiceover text.",
              "suggestedBackground": "matrix" | "abstract-blue" | "smoke" | "glitch-tech",
              "mood": "matching the requested tone"
            }`
          }]
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              script: { type: Type.STRING },
              suggestedBackground: { type: Type.STRING, enum: ["matrix", "abstract-blue", "smoke", "glitch-tech"] },
              mood: { type: Type.STRING }
            },
            required: ["script", "suggestedBackground"]
          }
        }
      });

      const data = JSON.parse(generation.text || '{}');
      if (!data.script) throw new Error("Could not extract script from response.");
      
      setEditableScript(data.script);
      setDraftedBackground(data.suggestedBackground);
      setStatus('Draft Generated');
    } catch (err: any) {
      console.error("Drafting error:", err);
      const cleanMsg = parseErrorMessage(err);
      if (cleanMsg.includes('429') || cleanMsg.includes('quota') || cleanMsg.includes('Quota')) {
        setErrorMessage("عذراً، نفذت الحصة المجانية لـ API. يرجى الانتظار قليلاً أو وضع مفتاح API الخاص بك في الحقل المخصص في الأعلى.\n(API Quota Exceeded. Please provide your own API key in the top field.)");
      } else {
        setErrorMessage("Failed to generate draft: " + cleanMsg);
      }
      setStatus('Error');
    } finally {
      setIsDrafting(false);
    }
  };

  const assembleVideo = async () => {
    if (!editableScript) return;
    if (!ai) {
      setErrorMessage("يرجى إدخال مفتاح API في الحقل الموجود في الأعلى للمتابعة.");
      return;
    }
    setIsAssembling(true);
    setVideoData(null);
    setVideoUrl(null);
    setErrorMessage(null);
    
    try {
      // 1. Generate Audio first to get duration
      setStatus('Synthesizing Voice...');
      const toneDescriptions = {
        cinematic: "with a deep, cinematic, and dramatic tone",
        professional: "in a professional, clear, and authoritative tone",
        calm: "with a calm, soothing, and gentle tone",
        energetic: "with high energy, excitement, and intensity"
      };

      const ttsResponse = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: `Say ${toneDescriptions[tone] || "naturally"}: ${editableScript}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("Audio synthesis failed");

      const binaryString = window.atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      console.log("Audio synthesis successful, bytes:", bytes.length);
      const audioDuration = bytes.length / (2 * 24000); // 16-bit mono 24kHz = 2 bytes per sample
      console.log("Calculated audio duration:", audioDuration);
      
      const wavBuffer = encodeWAV(bytes, 24000);
      
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      const wavBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(wavBlob);
      });

      const saveRes = await fetch('/api/save-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data: wavBase64, format: 'wav' })
      });
      
      if (!saveRes.ok) {
        const errorText = await saveRes.text();
        throw new Error(`Failed to save audio: ${saveRes.status} ${errorText.substring(0, 100)}`);
      }
      
      const { url: serverUrl } = await saveRes.json();
      const absoluteAudioUrl = `${window.location.origin}${serverUrl}`;

      // 2. Orchestrate Visuals based on script and exact duration
      setStatus('Mapping Visuals...');
      const imageDescription = imageAssets.length > 0 
        ? `You have ${imageAssets.length} images. Use placeholders "image_0" to "image_${imageAssets.length-1}" in visualSequence.`
        : '';

      const generation = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [{
          role: "user",
          parts: [{
            text: `Map visual text elements for this script: "${editableScript}".
            THE TOTAL DURATION IS EXACTLY ${audioDuration.toFixed(2)} SECONDS.
            
            ${imageDescription}

            Requirements:
            - STRICT: Use the EXACT language of the script (e.g. if script is Arabic, use Arabic words for "text").
            - DO NOT translate to English.
            - Timing that matches the "${tone}" mood (e.g. punchy for energetic, smooth for calm).
            - Visual text (1-4 words bold).
            - animationStyle: "zoom" | "slide-up" | "reveal" | "shake" | "glitch".
            
            Return JSON:
            {
              "visualSequence": [
                { "text": "GO!", "startInSeconds": 0, "durationInSeconds": 0.5, "animationStyle": "zoom", "color": "#ff0000", "imageUrl": "image_0" }
              ],
              "themeConfig": { "primaryColor": "#000", "secondaryColor": "#333" }
            }`
          }]
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              visualSequence: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    startInSeconds: { type: Type.NUMBER },
                    durationInSeconds: { type: Type.NUMBER },
                    animationStyle: { type: Type.STRING, enum: ["zoom", "slide-up", "reveal", "shake", "glitch"] },
                    color: { type: Type.STRING },
                    imageUrl: { type: Type.STRING }
                  },
                  required: ["text", "startInSeconds", "durationInSeconds"]
                }
              },
              themeConfig: {
                type: Type.OBJECT,
                properties: {
                  primaryColor: { type: Type.STRING },
                  secondaryColor: { type: Type.STRING }
                }
              }
            }
          }
        }
      });

      const orchestratorData = JSON.parse(generation.text || '{}');
      
      const BACKGROUND_MAP: Record<string, string> = {
        "matrix": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
        "abstract-blue": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
        "smoke": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
        "glitch-tech": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4"
      };

      const mappedSequence = (orchestratorData.visualSequence || []).map((event: any) => {
        if (event.imageUrl && event.imageUrl.startsWith('image_')) {
          const index = parseInt(event.imageUrl.split('_')[1]);
          return { ...event, imageUrl: imageAssets[index] || undefined };
        }
        return event;
      });

      const aspectDimensions = {
        '16:9': { width: 1920, height: 1080 },
        '9:16': { width: 1080, height: 1920 },
        '1:1': { width: 1080, height: 1080 }
      }[aspectRatio];

      const finalData: MyVideoProps = {
        ...orchestratorData,
        visualSequence: mappedSequence,
        audioUrl: absoluteAudioUrl,
        videoBackgroundUrl: customVideoUrl || BACKGROUND_MAP[draftedBackground] || BACKGROUND_MAP["abstract-blue"],
        durationInFrames: Math.ceil(Math.max(3, audioDuration + 0.5) * 30),
        ...aspectDimensions
      };

      setVideoData(finalData);
      setStatus('Assembly Complete');
    } catch (err: any) {
      console.error(err);
      const cleanMsg = parseErrorMessage(err);
      if (cleanMsg.includes('429') || cleanMsg.includes('quota') || cleanMsg.includes('Quota')) {
        setErrorMessage("عذراً، نفذت الحصة المجانية لـ API. يرجى الانتظار قليلاً أو وضع مفتاح API الخاص بك في الحقل المخصص في الأعلى.");
      } else {
        setErrorMessage("Assembly failed: " + cleanMsg);
      }
      setStatus('Error');
    } finally {
      setIsAssembling(false);
    }
  };

  const generateAudioPreview = async () => {
    if (!editableScript || !ai) return;
    setStatus('Synthesizing Preview...');
    
    const toneDescriptions = {
      cinematic: "with a deep, cinematic, and dramatic tone",
      professional: "in a professional, clear, and authoritative tone",
      calm: "with a calm, soothing, and gentle tone",
      energetic: "with high energy, excitement, and intensity"
    };

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: `Say ${toneDescriptions[tone] || "naturally"}: ${editableScript}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const binaryString = window.atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const wavBuffer = encodeWAV(bytes, 24000);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
        setStatus('Preview Playing');
      }
    } catch (err: any) {
      console.error("Preview error:", err);
      const cleanMsg = parseErrorMessage(err);
      if (cleanMsg.includes('429') || cleanMsg.includes('quota') || cleanMsg.includes('Quota')) {
        setErrorMessage("عذراً، نفذت حصة معاينة الصوت. يرجى الانتظار قليلاً أو استخدام مفتاح API خاص بك.");
      } else {
        setErrorMessage("Preview failed: " + cleanMsg);
      }
    }
  };

  const QuotaInfo = () => (
    <div className="bg-purple-900/20 border border-purple-500/20 rounded-xl p-4">
      <div className="flex gap-3">
        <div className="p-2 bg-purple-500/20 rounded-lg h-fit">
          <Key className="w-4 h-4 text-purple-400" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-purple-300 mb-1">تجاوزت الحصة المجانية؟ (Quota Limit?)</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            يستخدم هذا التطبيق حصة Gemini API مشتركة. إذا واجهت خطأ (429)، فهذا يعني أن عدد المستخدمين كبير حالياً. 
            يمكنك حل ذلك بوضع مفتاح API الخاص بك من Google AI Studio في الحقل المخصص بالأعلى.
          </p>
        </div>
      </div>
    </div>
  );

  function encodeWAV(samples: Uint8Array, sampleRate: number = 24000) {
    const buffer = new ArrayBuffer(44 + samples.length);
    const view = new DataView(buffer);
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 32 + samples.length, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length, true);
    const pcm = new Uint8Array(buffer, 44);
    pcm.set(samples);
    return buffer;
  }

  const triggerRender = async () => {
    if (!videoData) return;
    setIsRendering(true);
    setRenderProgress(0);
    setRenderStatus('Contacting render farm...');
    
    try {
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputProps: videoData })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Render request failed: ${response.status} ${errorText.substring(0, 100)}`);
      }

      if (!response.body) throw new Error("No response body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (data.percent) setRenderProgress(data.percent);
            if (data.message) setRenderStatus(data.message);
            if (data.url) setVideoUrl(data.url);
            if (data.error) throw new Error(data.error);
          }
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message);
      setRenderStatus('Render Failed');
    } finally {
      setIsRendering(false);
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCustomVideoUrl(url);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const fileArray = Array.from(files) as File[];
      const newAssets = fileArray.map(file => URL.createObjectURL(file));
      setImageAssets(prev => [...prev, ...newAssets]);
    }
  };

  const removeImage = (index: number) => {
    setImageAssets(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 selection:bg-purple-500/30">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-white/10 pb-8">
          <div className="space-y-1">
            <h1 className="text-4xl font-black tracking-tighter flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl shadow-lg shadow-purple-500/20">
                <Film className="w-8 h-8 text-white" />
              </div>
              ROBO<span className="text-purple-500">RENDER</span>
            </h1>
            <p className="text-slate-400 font-medium text-sm">Kinetic Typography with Gemini 3.1 Flash</p>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">API Key (Gemini)</span>
              <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noreferrer"
                className="text-[10px] text-purple-400 hover:text-purple-300 transition-colors font-medium"
              >
                احصل على مفتاح (Get Key)
              </a>
            </div>
            <div className="flex items-center gap-4 bg-slate-900/50 p-2 rounded-2xl border border-white/5 backdrop-blur-xl group focus-within:border-purple-500/50 transition-all">
              <div className="p-2 bg-slate-800 rounded-lg group-focus-within:bg-purple-900/40 transition-all">
                <Key className="w-5 h-5 text-slate-400 group-focus-within:text-purple-400" />
              </div>
              <input 
                type="password"
                placeholder="ضع مفتاح API هنا..."
                className="bg-transparent border-none outline-none text-sm w-48 font-mono placeholder:text-slate-600 text-white"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          <div className="lg:col-span-12">
            <QuotaInfo />
          </div>

          {/* Controls Panel */}
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-slate-900/50 border border-white/10 rounded-3xl p-6 space-y-6 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 blur-[60px] pointer-events-none" />
              
              <div className="space-y-4">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />
                  Video Concept
                </label>
                <textarea 
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. A motivational speech about the power of persistence..."
                  className="w-full bg-slate-800/50 border border-white/10 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-purple-500/50 outline-none transition-all resize-none h-24"
                />
                
                {!editableScript && (
                  <button 
                    onClick={draftScript}
                    disabled={isDrafting || !prompt}
                    className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-xl shadow-purple-500/20 flex items-center justify-center gap-3 animate-pulse-slow"
                  >
                    {isDrafting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Generating Draft...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        <span>1. Generate Video Draft</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {editableScript && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-purple-400 uppercase tracking-widest flex items-center gap-2">
                      <Volume2 className="w-3 h-3" />
                      Refine Script
                    </label>
                    <button 
                      onClick={() => setEditableScript('')}
                      className="text-[10px] text-slate-500 hover:text-white transition-colors"
                    >
                      Reset Prompt
                    </button>
                  </div>
                  <textarea 
                    value={editableScript}
                    onChange={(e) => setEditableScript(e.target.value)}
                    placeholder="Refine the AI's script here..."
                    className="w-full bg-purple-500/10 border border-purple-500/30 rounded-2xl p-4 text-sm focus:ring-2 focus:ring-purple-500/50 outline-none transition-all h-32 text-purple-100 placeholder:text-purple-500/50"
                  />
                  
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-slate-500" />
                      <select 
                        value={selectedVoice}
                        onChange={(e) => setSelectedVoice(e.target.value)}
                        className="flex-1 bg-slate-800/50 border border-white/10 rounded-xl p-3 text-xs focus:ring-2 focus:ring-purple-500/50 outline-none appearance-none cursor-pointer"
                      >
                        {GEMINI_VOICES.map(v => (
                          <option key={v.name} value={v.name}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={generateAudioPreview}
                        disabled={isDrafting || isAssembling || !editableScript}
                        className="col-span-1 bg-slate-800 hover:bg-slate-700 text-white py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                      >
                         <Volume2 className="w-4 h-4" />
                         Preview Audio
                      </button>
                      <button 
                         onClick={assembleVideo}
                         disabled={isAssembling || !editableScript}
                         className="col-span-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-3"
                      >
                          {isAssembling ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Zap className="w-5 h-5" />
                          )}
                          <span>2. Finalize Video</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Film className="w-3 h-3" />
                  Image Assets
                </label>
                <div 
                  onClick={() => imageInputRef.current?.click()}
                  className="w-full bg-slate-800/50 border-2 border-dashed border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-purple-500/50 hover:bg-slate-800 transition-all group"
                >
                  <input 
                    type="file" 
                    ref={imageInputRef} 
                    onChange={handleImageUpload} 
                    accept="image/*" 
                    multiple
                    className="hidden" 
                  />
                  <Upload className="w-5 h-5 text-slate-500 group-hover:text-purple-500 transition-colors" />
                  <span className="text-[10px] font-bold text-slate-400 text-center">Drop Assets Here (Optional)</span>
                </div>
                
                {imageAssets.length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {imageAssets.map((url, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-white/10 group/img">
                        <img src={url} className="w-full h-full object-cover" alt="" />
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                          className="absolute inset-0 bg-red-500/80 items-center justify-center hidden group-hover/img:flex transition-all"
                        >
                          <RefreshCw className="w-4 h-4 text-white rotate-45" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Zap className="w-3 h-3" />
                  Action Background
                </label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full bg-slate-800/50 border-2 border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-purple-500/50 hover:bg-slate-800 transition-all group"
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleVideoUpload} 
                    accept="video/*" 
                    className="hidden" 
                  />
                  {customVideoUrl ? (
                    <div className="flex flex-col items-center gap-1">
                      <div className="p-2 bg-green-500/20 rounded-lg">
                        <CheckCircle2 className="w-6 h-6 text-green-500" />
                      </div>
                      <span className="text-[10px] font-bold text-slate-400">Custom Action Loaded</span>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-slate-500 group-hover:text-purple-500 transition-colors" />
                      <span className="text-[10px] font-bold text-slate-400">Upload Action Video</span>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <TypeIcon className="w-3 h-3" />
                  Video Style
                </label>
                <div className="p-4 bg-slate-800/50 border border-white/5 rounded-2xl space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Aspect Ratio</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['16:9', '9:16', '1:1'] as const).map((ratio) => (
                        <button
                          key={ratio}
                          onClick={() => setAspectRatio(ratio)}
                          className={`py-2 rounded-lg text-[10px] font-bold border transition-all ${
                            aspectRatio === ratio 
                              ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-500/20' 
                              : 'bg-slate-800 border-white/5 text-slate-400 hover:border-white/20'
                          }`}
                        >
                          {ratio === '16:9' && 'Landscape (16:9)'}
                          {ratio === '9:16' && 'Portrait (9:16)'}
                          {ratio === '1:1' && 'Square (1:1)'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Background and theme colors are determined based on your <span className="text-purple-400">Script Mood</span>.
                  </p>
                </div>
              </div>

              {/* Selection: Tone */}
              <div className="space-y-4">
                <label className="text-xs font-bold text-slate-400 flex items-center gap-2">
                  <Mic2 className="w-3 h-3" />
                  Voice Tone
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cinematic', 'professional', 'calm', 'energetic'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTone(t)}
                      className={`py-2 px-3 rounded-xl border text-[10px] font-bold capitalize transition-all ${
                        tone === t
                          ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-slate-800 border-white/5 text-slate-400 hover:border-white/20'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {errorMessage && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
                    <p className="text-xs text-red-100 leading-relaxed font-mono flex-1">
                      {errorMessage}
                    </p>
                    <button onClick={() => setErrorMessage(null)} className="text-red-500/50 hover:text-red-500">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {(errorMessage.includes('429') || errorMessage.includes('Quota')) && (
                    <button 
                      onClick={() => draftScript()}
                      className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 text-red-100 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all border border-red-500/20"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Try Re-docking with AI
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* Preview / Render Panel */}
          <div className="lg:col-span-8 space-y-6">
            <div className={`bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl relative flex items-center justify-center group/preview transition-all duration-500 mx-auto ${
              aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[80vh]' : 
              aspectRatio === '1:1' ? 'aspect-square max-h-[70vh]' : 
              'aspect-video w-full'
            }`}>
              {!videoData && !isRendering && (
                <div className="text-center space-y-4 opacity-40">
                  <Film className="w-16 h-16 mx-auto stroke-1" />
                  <p className="text-sm font-medium">Generate a sequence to see the preview</p>
                </div>
              )}

              {videoData && !isRendering && !videoUrl && (
                <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
                  <button 
                    onClick={triggerRender}
                    className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 shadow-xl shadow-purple-900/40"
                  >
                    <Zap className="w-4 h-4" />
                    Render Final Video
                  </button>
                  <button 
                    onClick={() => { setVideoData(null); setVideoUrl(null); }}
                    className="bg-white/10 hover:bg-white/20 backdrop-blur-md text-white p-2.5 rounded-xl transition-all"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              )}

              {videoData && !isRendering && videoUrl && (
                <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
                  <a 
                    href={`/api/download?filename=${videoUrl.split('/').pop()}`}
                    className="bg-green-600 hover:bg-green-500 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 shadow-xl shadow-green-900/40"
                  >
                    <Download className="w-4 h-4" />
                    Download MP4
                  </a>
                  <button 
                    onClick={() => { setVideoUrl(null); }}
                    className="bg-white/10 hover:bg-white/20 backdrop-blur-md text-white p-2.5 rounded-xl transition-all"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              )}

              {videoData && !isRendering && !videoUrl && (
                 <div className="w-full h-full">
                   <Player
                     key={`${videoData.audioUrl}-${aspectRatio}` || 'no-audio'}
                     component={MyVideo}
                     durationInFrames={videoData.durationInFrames || 300}
                     compositionWidth={videoData.width || 1920}
                     compositionHeight={videoData.height || 1080}
                     fps={30}
                     inputProps={videoData}
                     style={{
                       width: '100%',
                       height: '100%',
                       backgroundColor: '#000'
                     }}
                     controls
                     autoPlay
                     loop
                     volume={1}
                   />
                 </div>
              )}

              {isRendering && (
                <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center p-12 space-y-8 z-20">
                  <div className="relative w-32 h-32">
                    <svg className="w-full h-full -rotate-90">
                      <circle 
                        cx="64" cy="64" r="60" 
                        className="stroke-slate-800 fill-none stroke-[8px]"
                      />
                      <circle 
                        cx="64" cy="64" r="60" 
                        className="stroke-purple-500 fill-none stroke-[8px] transition-all duration-300"
                        strokeDasharray="377"
                        strokeDashoffset={377 - (377 * renderProgress) / 100}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-2xl font-black font-mono">{Math.round(renderProgress)}%</span>
                    </div>
                  </div>
                  <div className="text-center animate-pulse">
                    <p className="text-sm font-bold uppercase tracking-widest text-purple-400">{renderStatus || 'Rendering...'}</p>
                  </div>
                </div>
              )}

              {videoUrl && (
                <video 
                  src={videoUrl} 
                  controls 
                  className="w-full h-full object-contain"
                  autoPlay
                />
              )}
            </div>

            {/* Sequence Details */}
            {videoData && !isRendering && (
              <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 italic">Visual Timing Map</h3>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 bg-slate-800 px-3 py-1 rounded-full">
                    <Terminal className="w-3 h-3" />
                    SEQUENCE LOCKED • {videoData.durationInFrames} FRAMES
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {videoData.visualSequence?.slice(0, 8).map((event, i) => (
                    <div key={i} className="bg-slate-800/30 p-3 rounded-xl border border-white/5 space-y-2 hover:bg-slate-800/50 transition-colors cursor-default">
                      <div className="text-[10px] font-bold text-slate-500 flex justify-between">
                        <span>{parseFloat(event.startInSeconds.toString()).toFixed(1)}s</span>
                        <span className="text-purple-400 uppercase">{event.animationStyle}</span>
                      </div>
                      <p className="text-xs font-black truncate text-white">{event.text}</p>
                      <div className="h-1 rounded-full w-full bg-slate-700/50 overflow-hidden">
                        <div className="h-full" style={{ backgroundColor: event.color, width: '40%' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>

        <footer className="pt-12 pb-8 text-center border-t border-white/5 space-y-2">
          <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Remotion Cloud Runner • Gemini 3.1 Flash Engine • v2.1.0-stable</p>
        </footer>
      </div>
    </div>
  );
}
