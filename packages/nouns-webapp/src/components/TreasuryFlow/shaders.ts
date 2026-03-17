/**
 * GLSL shaders for the particle stream system.
 * Particles flow along links between nodes, showing ETH movement.
 */

export const particleVertexShader = /* glsl */ `
  uniform float uTime;
  attribute vec3 aStartPos;
  attribute vec3 aEndPos;
  attribute float aOffset;
  attribute float aSpeed;
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float t = fract(aOffset + uTime * aSpeed);
    vec3 pos = mix(aStartPos, aEndPos, t);

    // Sinusoidal wobble perpendicular to the path for organic feel
    vec3 dir = normalize(aEndPos - aStartPos);
    // Pick a perpendicular vector (avoid degenerate cross when dir ~= up)
    vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 perp = normalize(cross(dir, up));
    vec3 perp2 = normalize(cross(dir, perp));
    float wobbleAmount = length(aEndPos - aStartPos) * 0.04;
    pos += perp * sin(t * 6.2832 + aOffset * 12.566) * wobbleAmount;
    pos += perp2 * cos(t * 6.2832 * 1.3 + aOffset * 9.42) * wobbleAmount * 0.6;

    vColor = aColor;
    // Fade in at start, fade out at end for smooth looping
    vAlpha = sin(t * 3.14159) * 0.85;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (180.0 / -mvPos.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 24.0);
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = vAlpha * smoothstep(0.5, 0.08, d);
    gl_FragColor = vec4(vColor, alpha);
  }
`;
