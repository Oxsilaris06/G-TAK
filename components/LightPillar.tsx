import React, { useRef, useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import * as THREE from 'three';

interface LightPillarProps {
  topColor?: string;
  bottomColor?: string;
  intensity?: number;
  rotationSpeed?: number;
  interactive?: boolean; // Note: Interaction souris désactivée pour mobile (complexe à mapper)
  glowAmount?: number;
  pillarWidth?: number;
  pillarHeight?: number;
  noiseIntensity?: number;
  pillarRotation?: number;
}

// --- Shader Definitions ---
const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec3 uTopColor;
  uniform vec3 uBottomColor;
  uniform float uIntensity;
  uniform float uGlowAmount;
  uniform float uPillarWidth;
  uniform float uPillarHeight;
  uniform float uNoiseIntensity;
  uniform float uPillarRotation;
  varying vec2 vUv;

  const float PI = 3.141592653589793;
  const float EPSILON = 0.001;
  const float E = 2.71828182845904523536;
  const float HALF = 0.5;

  mat2 rot(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
  }

  // Procedural noise function
  float noise(vec2 coord) {
    float G = E;
    vec2 r = (G * sin(G * coord));
    return fract(r.x * r.y * (1.0 + coord.x));
  }

  // Apply layered wave deformation to position
  vec3 applyWaveDeformation(vec3 pos, float timeOffset) {
    float frequency = 1.0;
    float amplitude = 1.0;
    vec3 deformed = pos;
    
    for(float i = 0.0; i < 4.0; i++) {
      deformed.xz *= rot(0.4);
      float phase = timeOffset * i * 2.0;
      vec3 oscillation = cos(deformed.zxy * frequency - phase);
      deformed += oscillation * amplitude;
      frequency *= 2.0;
      amplitude *= HALF;
    }
    return deformed;
  }

  // Polynomial smooth blending between two values
  float blendMin(float a, float b, float k) {
    float scaledK = k * 4.0;
    float h = max(scaledK - abs(a - b), 0.0);
    return min(a, b) - h * h * 0.25 / scaledK;
  }

  float blendMax(float a, float b, float k) {
    return -blendMin(-a, -b, k);
  }

  void main() {
    vec2 fragCoord = vUv * uResolution;
    vec2 uv = (fragCoord * 2.0 - uResolution) / uResolution.y;
    
    // Apply 2D rotation to UV coordinates
    float rotAngle = uPillarRotation * PI / 180.0;
    uv *= rot(rotAngle);

    vec3 origin = vec3(0.0, 0.0, -10.0);
    vec3 direction = normalize(vec3(uv, 1.0));

    float maxDepth = 50.0;
    float depth = 0.1;

    mat2 rotX = rot(uTime * 0.3);
    
    vec3 color = vec3(0.0);
    
    for(float i = 0.0; i < 100.0; i++) {
      vec3 pos = origin + direction * depth;
      pos.xz *= rotX;

      // Apply vertical scaling and wave deformation
      vec3 deformed = pos;
      deformed.y *= uPillarHeight;
      deformed = applyWaveDeformation(deformed + vec3(0.0, uTime, 0.0), uTime);
      
      // Calculate distance field using cosine pattern
      vec2 cosinePair = cos(deformed.xz);
      float fieldDistance = length(cosinePair) - 0.2;
      
      // Radial boundary constraint
      float radialBound = length(pos.xz) - uPillarWidth;
      fieldDistance = blendMax(radialBound, fieldDistance, 1.0);
      fieldDistance = abs(fieldDistance) * 0.15 + 0.01;

      vec3 gradient = mix(uBottomColor, uTopColor, smoothstep(15.0, -15.0, pos.y));
      color += gradient * pow(1.0 / fieldDistance, 1.0);

      if(fieldDistance < EPSILON || depth > maxDepth) break;
      depth += fieldDistance;
    }

    // Normalize by pillar width to maintain consistent glow regardless of size
    float widthNormalization = uPillarWidth / 3.0;
    color = tanh(color * uGlowAmount / widthNormalization);
    
    // Add noise postprocessing
    float rnd = noise(gl_FragCoord.xy);
    color -= rnd / 15.0 * uNoiseIntensity;
    
    gl_FragColor = vec4(color * uIntensity, 1.0);
  }
`;

const PillarMesh: React.FC<LightPillarProps> = ({
  topColor = '#5227FF',
  bottomColor = '#FF9FFC',
  intensity = 1.0,
  rotationSpeed = 0.3,
  glowAmount = 0.005,
  pillarWidth = 3.0,
  pillarHeight = 0.4,
  noiseIntensity = 0.5,
  pillarRotation = 0
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uTopColor: { value: new THREE.Color(topColor) },
      uBottomColor: { value: new THREE.Color(bottomColor) },
      uIntensity: { value: intensity },
      uGlowAmount: { value: glowAmount },
      uPillarWidth: { value: pillarWidth },
      uPillarHeight: { value: pillarHeight },
      uNoiseIntensity: { value: noiseIntensity },
      uPillarRotation: { value: pillarRotation },
    }),
    [topColor, bottomColor, intensity, glowAmount, pillarWidth, pillarHeight, noiseIntensity, pillarRotation]
  );

  // Update uniforms on resize
  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime * rotationSpeed;
      // Ensure resolution matches current viewport
      materialRef.current.uniforms.uResolution.value.set(size.width, size.height);
    }
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
};

const LightPillar: React.FC<LightPillarProps> = (props) => {
  return (
    <View style={styles.container} pointerEvents="none">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 1], zoom: 1 }}
        style={styles.canvas}
      >
        <PillarMesh {...props} />
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1, // Derrière tout le contenu
    backgroundColor: '#000', // Fond noir par défaut
  },
  canvas: {
    flex: 1,
  },
});
export default LightPillar;
