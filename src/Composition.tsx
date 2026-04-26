import React from 'react';
import { AbsoluteFill, useVideoConfig, useCurrentFrame, interpolate, spring, Audio, Video } from 'remotion';

export interface VisualEvent {
  text: string;
  startInSeconds: number;
  durationInSeconds: number;
  animationStyle?: 'zoom' | 'slide-up' | 'reveal' | 'shake' | 'glitch';
  color?: string;
  intensity?: number;
  imageUrl?: string;
}

export interface MyVideoProps {
  audioUrl?: string;
  videoBackgroundUrl?: string; // High-energy action background
  visualSequence?: VisualEvent[];
  imageAssets?: string[]; // Global available assets
  themeConfig?: {
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
  };
  durationInFrames?: number;
  width?: number;
  height?: number;
}

export const MyVideo: React.FC<MyVideoProps> = ({ 
  audioUrl,
  videoBackgroundUrl,
  visualSequence = [], 
  themeConfig 
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const primaryColor = themeConfig?.primaryColor || '#2563eb';
  const secondaryColor = themeConfig?.secondaryColor || '#1e40af';
  const fontFamily = themeConfig?.fontFamily || 'Inter, sans-serif';

  const currentEvent = visualSequence.find(event => {
    const startFrame = event.startInSeconds * fps;
    const endFrame = (event.startInSeconds + event.durationInSeconds) * fps;
    return frame >= startFrame && frame < endFrame;
  }) || visualSequence[0];

  if (!currentEvent) return <AbsoluteFill style={{ backgroundColor: '#000' }} />;

  const eventStartFrame = currentEvent.startInSeconds * fps;
  const localFrame = frame - eventStartFrame;

  // ANIMATION LOGIC
  const entrance = spring({
    frame: localFrame,
    fps,
    config: { damping: 10, mass: 0.6 },
  });

  const getGlitchStyle = () => {
    if (currentEvent.animationStyle === 'glitch') {
      const offset = Math.random() > 0.8 ? (Math.random() - 0.5) * 20 : 0;
      return {
        textShadow: `${offset}px 0 #ff00ff, ${-offset}px 0 #00ffff`,
        transform: `skew(${offset * 0.5}deg)`,
      };
    }
    return {};
  };

  const getRotation = () => {
    if (currentEvent.animationStyle === 'shake') {
      return (Math.sin(frame * 1.2) * 8);
    }
    if (currentEvent.animationStyle === 'glitch') {
      return (Math.random() - 0.5) * 5;
    }
    return 0;
  };

  const getFilter = () => {
    if (currentEvent.animationStyle === 'glitch') {
      return `hue-rotate(${frame * 10}deg) brightness(1.2) saturate(1.5)`;
    }
    return 'none';
  };

  const textStyle: React.CSSProperties = {
    color: currentEvent.color || 'white',
    transform: `scale(${interpolate(entrance, [0, 1], [0.5, 1.4])}) rotate(${getRotation()}deg)`,
    fontFamily: fontFamily,
    opacity: entrance,
    filter: getFilter(),
    ...getGlitchStyle(),
  };

  const [videoError, setVideoError] = React.useState(false);

  return (
    <AbsoluteFill style={{ 
      backgroundColor: primaryColor, 
      overflow: 'hidden',
      transform: currentEvent.animationStyle === 'shake' ? `translate(${(Math.random()-0.5)*10}px, ${(Math.random()-0.5)*10}px)` : 'none'
    }}>
      {/* ACTION BACKGROUND VIDEO */}
      {videoBackgroundUrl && !videoError ? (
        <Video 
          src={videoBackgroundUrl} 
          muted 
          loop 
          crossOrigin="anonymous"
          onError={() => setVideoError(true)}
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'cover',
            opacity: 0.4,
            filter: 'contrast(1.2) brightness(0.8)'
          }} 
        />
      ) : (
        <div 
          className="absolute inset-0 opacity-40"
          style={{
            background: `linear-gradient(45deg, ${primaryColor}, ${secondaryColor})`
          }}
        />
      )}

      {audioUrl && <Audio src={audioUrl} volume={1} />}

      {/* OVERLAY FX */}
      <div className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-30">
        <div className="w-full h-full bg-[radial-gradient(circle_at_center,_transparent_0%,_black_100%)]" />
      </div>

      <div className="relative z-10 px-20 text-center flex items-center justify-center h-full flex-col gap-8">
        {currentEvent.imageUrl && (
          <div 
            className="w-96 h-96 overflow-hidden rounded-3xl border-8 border-white/20 shadow-2xl"
            style={{
              transform: `scale(${interpolate(entrance, [0, 1], [0.8, 1])}) rotate(${-getRotation() * 0.5}deg)`,
              opacity: entrance,
            }}
          >
            <img 
               src={currentEvent.imageUrl} 
               className="w-full h-full object-cover" 
               alt=""
               referrerPolicy="no-referrer"
            />
          </div>
        )}
        <h1 
          className="text-8xl font-black tracking-tight drop-shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
          style={textStyle}
          dir="auto"
        >
          {currentEvent.text}
        </h1>
      </div>

      {/* Progress */}
      <div 
        className="absolute bottom-0 left-0 h-4 bg-white/20 backdrop-blur-md transition-all duration-75"
        style={{ width: `${(frame / (useVideoConfig().durationInFrames)) * 100}%` }}
      />
    </AbsoluteFill>
  );
};
