import React, { useEffect, useRef } from 'react';
import { Text, Animated, StyleSheet, TouchableOpacity, ViewStyle, TextStyle, Easing } from 'react-native';

interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number; // Vitesse de l'animation en secondes
  className?: string;
  color?: string; // Couleur de base
  shineColor?: string; // Couleur de l'éclat
  style?: ViewStyle;
  textStyle?: TextStyle;
  onPress?: () => void;
}

const ShinyText: React.FC<ShinyTextProps> = ({
  text,
  disabled = false,
  speed = 2,
  color = '#b5b5b5',
  shineColor = '#ffffff',
  style,
  textStyle,
  onPress
}) => {
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (disabled) return;

    const startAnimation = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: speed * 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false, // Nécessaire pour l'interpolation de couleur
          }),
          Animated.timing(animatedValue, {
            toValue: 0,
            duration: speed * 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      ).start();
    };

    startAnimation();
  }, [disabled, speed]);

  const colorInterpolation = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [color, shineColor, color],
  });

  const opacityInterpolation = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.8, 1, 0.8],
  });

  return (
    <TouchableOpacity 
      onPress={onPress} 
      disabled={disabled} 
      activeOpacity={0.7}
      style={[styles.container, style]}
    >
      <Animated.Text
        style={[
          styles.text,
          textStyle,
          {
            color: colorInterpolation,
            opacity: opacityInterpolation,
            textShadowColor: shineColor,
            textShadowRadius: animatedValue.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0, 10, 0]
            })
          },
        ]}
      >
        {text}
      </Animated.Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
});

export default ShinyText;
