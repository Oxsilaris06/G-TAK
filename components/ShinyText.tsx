import React, { useEffect, useRef } from 'react';
import { TouchableOpacity, Animated, TextStyle, ViewStyle } from 'react-native';

interface ShinyTextProps {
  text: string;
  textStyle?: TextStyle;
  style?: ViewStyle;
  onPress?: () => void;
  speed?: number;
  color?: string;
  shineColor?: string;
  yoyo?: boolean;
}

const ShinyText: React.FC<ShinyTextProps> = ({ 
  text, 
  textStyle, 
  style, 
  onPress,
  speed = 3,
  color = '#ffffff',
  shineColor = '#0008ff',
  yoyo = false
}) => {
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const duration = speed * 1000;
    
    const forwardAnim = Animated.timing(animatedValue, {
      toValue: 1,
      duration: duration,
      useNativeDriver: false // Color interpolation requires useNativeDriver: false
    });

    const backwardAnim = Animated.timing(animatedValue, {
      toValue: 0,
      duration: duration,
      useNativeDriver: false
    });

    const animation = yoyo 
      ? Animated.sequence([forwardAnim, backwardAnim]) 
      : forwardAnim;

    Animated.loop(animation).start();
  }, [speed, yoyo]);

  const textColorInterpolation = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [color, shineColor]
  });

  return (
    <TouchableOpacity onPress={onPress} style={style} activeOpacity={0.8}>
      <Animated.Text style={[textStyle, { color: textColorInterpolation }]}>
        {text}
      </Animated.Text>
    </TouchableOpacity>
  );
};

export default ShinyText;
