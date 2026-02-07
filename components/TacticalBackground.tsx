import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, Animated, Dimensions, Easing } from 'react-native';

const { width, height } = Dimensions.get('window');
const GRID_SIZE = 40;
const AGENT_COUNT = 5;
const MOVE_DURATION = 400;
const TRAIL_DURATION = 3000;

const THEME = {
  friendly: '#3b82f6',
  hostile: '#ef4444'
};

const TacticalBackground = () => {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const cols = Math.ceil(width / GRID_SIZE);
  const rows = Math.ceil(height / GRID_SIZE);

  const gridRegistry = useRef(new Map());

  const isCellFree = useCallback((x, y) => {
    const key = `${x},${y}`;
    const expiry = gridRegistry.current.get(key);
    if (!expiry) return true;
    if (Date.now() > expiry) {
      gridRegistry.current.delete(key);
      return true;
    }
    return false;
  }, []);

  const occupyCell = useCallback((x, y) => {
    const key = `${x},${y}`;
    gridRegistry.current.set(key, Date.now() + TRAIL_DURATION);
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.6, duration: 4000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 4000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const gridLines = useMemo(() => (
    <View style={styles.gridContainer}>
      {Array.from({ length: cols }).map((_, i) => (
        <View key={`v-${i}`} style={[styles.line, styles.vertical, { left: i * GRID_SIZE }]} />
      ))}
      {Array.from({ length: rows }).map((_, i) => (
        <View key={`h-${i}`} style={[styles.line, styles.horizontal, { top: i * GRID_SIZE }]} />
      ))}
    </View>
  ), []);

  return (
    <View style={styles.container} pointerEvents="none">
      {gridLines}
      <Animated.View style={[styles.scanner, { opacity: pulseAnim, transform: [{ scale: 1.5 }] }]} />

      {Array.from({ length: AGENT_COUNT }).map((_, index) => (
        <TacticalAgent
          key={index}
          cols={cols}
          rows={rows}
          startDelay={index * 800}
          isCellFree={isCellFree}
          occupyCell={occupyCell}
          type={index === 0 ? 'hostile' : 'friendly'}
        />
      ))}

      <View style={styles.vignette} />
    </View>
  );
};

const TacticalAgent = ({ cols, rows, startDelay, isCellFree, occupyCell, type = 'friendly' }) => {
  const [pos, setPos] = useState(null);
  const [prevPos, setPrevPos] = useState(null);
  const [staticTrail, setStaticTrail] = useState([]);

  const isHostile = type === 'hostile';
  const color = THEME[type];

  const moveAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(1)).current;
  const heartbeatAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isHostile) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(heartbeatAnim, { toValue: 1.4, duration: 120, useNativeDriver: true }),
          Animated.timing(heartbeatAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
          Animated.timing(heartbeatAnim, { toValue: 1.4, duration: 120, useNativeDriver: true }),
          Animated.timing(heartbeatAnim, { toValue: 1, duration: 640, useNativeDriver: true }),
        ])
      ).start();
    }
    const timer = setTimeout(() => spawn(), startDelay);
    return () => clearTimeout(timer);
  }, []);

  const spawn = () => {
    pulseScale.setValue(1);
    pulseOpacity.setValue(1);
    setStaticTrail([]);

    let start, attempts = 0;
    do {
      start = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
      attempts++;
    } while (!isCellFree(start.x, start.y) && attempts < 20);

    if (attempts >= 20) {
      setTimeout(spawn, 500);
      return;
    }

    occupyCell(start.x, start.y);

    let end;
    do {
      end = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
    } while (Math.abs(end.x - start.x) + Math.abs(end.y - start.y) < 6);

    setPos(start);
    setPrevPos(start);
    moveAnim.setValue({ x: start.x * GRID_SIZE, y: start.y * GRID_SIZE });
    moveStep(start, end);
  };

  const moveStep = (current, dest) => {
    if (current.x === dest.x && current.y === dest.y) {
      triggerArrivalPulse();
      return;
    }

    const dx = dest.x - current.x;
    const dy = dest.y - current.y;

    const moves = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx !== 0) moves.push({ x: current.x + (dx > 0 ? 1 : -1), y: current.y });
      if (dy !== 0) moves.push({ x: current.x, y: current.y + (dy > 0 ? 1 : -1) });
    } else {
      if (dy !== 0) moves.push({ x: current.x, y: current.y + (dy > 0 ? 1 : -1) });
      if (dx !== 0) moves.push({ x: current.x + (dx > 0 ? 1 : -1), y: current.y });
    }

    const neighbors = [
      { x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 }
    ].sort(() => Math.random() - 0.5);

    neighbors.forEach(n => {
      if (!moves.some(m => m.x === n.x && m.y === n.y)) moves.push(n);
    });

    let next = null;
    for (let m of moves) {
      if (m.x >= 0 && m.x < cols && m.y >= 0 && m.y < rows && isCellFree(m.x, m.y)) {
        next = m;
        break;
      }
    }

    if (next) {
      occupyCell(next.x, next.y);
      progressAnim.setValue(0);
      setPrevPos(current); // prevPos devient le "cul" de la ligne

      Animated.parallel([
        Animated.timing(moveAnim, {
          toValue: { x: next.x * GRID_SIZE, y: next.y * GRID_SIZE },
          duration: MOVE_DURATION,
          easing: Easing.linear,
          useNativeDriver: true
        }),
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: MOVE_DURATION,
          easing: Easing.linear,
          useNativeDriver: true
        })
      ]).start(({ finished }) => {
        if (finished) {
          const isVertical = next.x === current.x;
          const newSegment = {
            id: Date.now(),
            x: isVertical ? current.x : Math.min(current.x, next.x),
            y: isVertical ? Math.min(current.y, next.y) : current.y,
            isVertical: isVertical
          };
          setStaticTrail(prev => [newSegment, ...prev].slice(0, 8));
          setPos(next);
          moveStep(next, dest);
        }
      });
    } else {
      triggerArrivalPulse();
    }
  };

  const triggerArrivalPulse = () => {
    Animated.parallel([
      Animated.timing(pulseScale, { toValue: 3, duration: 800, useNativeDriver: true }),
      Animated.timing(pulseOpacity, { toValue: 0, duration: 800, useNativeDriver: true })
    ]).start(() => setTimeout(spawn, 1000));
  };

  if (!pos) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {staticTrail.map((seg) => (
        <FadeOutTrailLine key={seg.id} x={seg.x} y={seg.y} isVertical={seg.isVertical} color={color} />
      ))}
      {prevPos && (
        <ActiveTrailLine start={prevPos} headAnim={moveAnim} color={color} />
      )}
      <Animated.View
        style={[
          styles.agent,
          { transform: moveAnim.getTranslateTransform(), opacity: pulseOpacity }
        ]}
      >
        <View style={styles.agentCore} />
        <Animated.View
          style={[
            styles.agentGlow,
            {
              backgroundColor: color,
              transform: [{ scale: isHostile ? heartbeatAnim : 1 }]
            }
          ]}
        />
        <Animated.View
          style={[
            styles.pulseRing,
            { borderColor: color, transform: [{ scale: pulseScale }] }
          ]}
        />
      </Animated.View>
    </View>
  );
};

// Composant corrigé pour ne jamais dessiner devant la node
const ActiveTrailLine = ({ start, headAnim, color }) => {
  const startX = start.x * GRID_SIZE;
  const startY = start.y * GRID_SIZE;

  // Calcul du Scale : 0 -> 1 (ou 0 -> -1). Clampé pour ne pas dépasser 1.
  const scaleX = headAnim.x.interpolate({
    inputRange: [startX - GRID_SIZE, startX, startX + GRID_SIZE],
    outputRange: [-1, 0, 1],
    extrapolate: 'clamp'
  });

  const scaleY = headAnim.y.interpolate({
    inputRange: [startY - GRID_SIZE, startY, startY + GRID_SIZE],
    outputRange: [-1, 0, 1],
    extrapolate: 'clamp'
  });

  // Calcul de translation corrigé : (scale - 1) * width / 2
  const translateX = scaleX.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-GRID_SIZE, -GRID_SIZE / 2, 0],
    extrapolate: 'clamp'
  });

  const translateY = scaleY.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-GRID_SIZE, -GRID_SIZE / 2, 0],
    extrapolate: 'clamp'
  });

  return (
    <>
      {/* Ligne Horizontale */}
      <Animated.View style={[
        styles.trailLine,
        {
          backgroundColor: color, shadowColor: color,
          left: startX, top: startY,
          width: GRID_SIZE, height: 2,
          marginTop: -1,
          transform: [{ translateX }, { scaleX }]
        }
      ]} />
      {/* Ligne Verticale */}
      <Animated.View style={[
        styles.trailLine,
        {
          backgroundColor: color, shadowColor: color,
          left: startX, top: startY,
          width: 2, height: GRID_SIZE,
          marginLeft: -1,
          transform: [{ translateY }, { scaleY }]
        }
      ]} />
    </>
  );
};

const FadeOutTrailLine = ({ x, y, isVertical, color }) => {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 0, duration: 2500, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View
      style={[
        styles.trailLine,
        {
          backgroundColor: color,
          shadowColor: color,
          left: x * GRID_SIZE, top: y * GRID_SIZE,
          width: isVertical ? 2 : GRID_SIZE,
          height: isVertical ? GRID_SIZE : 2,
          opacity,
          transform: [{ translateX: isVertical ? -1 : 0 }, { translateY: isVertical ? 0 : -1 }]
        }
      ]}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050505',
    // Opacity removed to ensure visibility
  },
  gridContainer: { ...StyleSheet.absoluteFillObject, opacity: 0.1 },
  line: { position: 'absolute', backgroundColor: '#3b82f6' },
  vertical: { width: 1, height: '100%' },
  horizontal: { height: 1, width: '100%' },
  scanner: {
    position: 'absolute', top: -height / 2, left: -width / 2,
    width: width * 2, height: width * 2, borderRadius: width,
    borderWidth: 100, borderColor: 'rgba(59, 130, 246, 0.05)',
  },
  agent: { position: 'absolute', width: 0, height: 0, alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  agentCore: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF', position: 'absolute', zIndex: 2 },
  agentGlow: { width: 20, height: 20, borderRadius: 10, opacity: 0.5, position: 'absolute', zIndex: 1, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8, elevation: 5 },
  pulseRing: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, position: 'absolute', zIndex: 0 },
  trailLine: {
    position: 'absolute',
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 3, zIndex: 5,
  },
  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' }
});

export default TacticalBackground;
