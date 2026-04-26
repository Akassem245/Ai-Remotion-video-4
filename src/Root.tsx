import { Composition, getInputProps, registerRoot } from 'remotion';
import { MyVideo, MyVideoProps } from './Composition';

export const RemotionRoot = () => {
  const inputProps = getInputProps() as MyVideoProps;
  
  return (
    <>
      <Composition
        id="MainVideo"
        component={MyVideo}
        durationInFrames={inputProps.durationInFrames || 300}
        fps={30}
        width={inputProps.width || 1920}
        height={inputProps.height || 1080}
        defaultProps={{
          visualSequence: [
            { text: 'Sample Video', startInSeconds: 0, durationInSeconds: 5, animationStyle: 'zoom' }
          ]
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
