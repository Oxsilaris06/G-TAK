import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// Remplace LightPillar par une grille tactique native (Zéro GPU load)
const TacticalBackground = () => {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 3000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 3000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Grille de fond */}
      <View style={styles.gridContainer}>
        {Array.from({ length: 20 }).map((_, i) => (
          <View key={`v-${i}`} style={[styles.line, styles.vertical, { left: i * 40 }]} />
        ))}
        {Array.from({ length: 30 }).map((_, i) => (
          <View key={`h-${i}`} style={[styles.line, styles.horizontal, { top: i * 40 }]} />
        ))}
      </View>
      
      {/* Effet de scan radar subtil */}
      <Animated.View 
        style={[
          styles.scanner, 
          { 
            opacity: pulseAnim,
            transform: [{ scale: 1.5 }] 
          }
        ]} 
      />
      
      {/* Vignetage pour assombrir les bords */}
      <View style={styles.vignette} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050505',
    zIndex: -1,
    overflow: 'hidden',
  },
  gridContainer: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.1,
  },
  line: {
    position: 'absolute',
    backgroundColor: '#3b82f6', // Bleu tactique
  },
  vertical: {
    width: 1,
    height: '100%',
  },
  horizontal: {
    height: 1,
    width: '100%',
  },
  scanner: {
    position: 'absolute',
    top: -height / 2,
    left: -width / 2,
    width: width * 2,
    height: width * 2,
    borderRadius: width,
    borderWidth: 100, // Épais cercle
    borderColor: 'rgba(59, 130, 246, 0.05)',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // Astuce pour vignetage sans image: 
    // On ne peut pas faire de vrai dégradé radial performant sans SVG, 
    // donc on laisse simple ou on ajoute un overlay sombre si besoin.
    // Ici on reste minimaliste.
  }
});

export default TacticalBackground;
