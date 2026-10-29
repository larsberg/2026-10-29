export const noiseVolumeGLSL = /* glsl */`
float latticeHash(vec3 p) {
  p = mod(p,289.0);
  return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);
}
float noise3D(vec3 p) {
  vec3 cell=floor(p),f=fract(p),t=f*f*f*(f*(f*6.0-15.0)+10.0);
  float a=mix(latticeHash(cell),latticeHash(cell+vec3(1,0,0)),t.x);
  float b=mix(latticeHash(cell+vec3(0,1,0)),latticeHash(cell+vec3(1,1,0)),t.x);
  float c=mix(latticeHash(cell+vec3(0,0,1)),latticeHash(cell+vec3(1,0,1)),t.x);
  float d=mix(latticeHash(cell+vec3(0,1,1)),latticeHash(cell+vec3(1,1,1)),t.x);
  return mix(mix(a,b,t.y),mix(c,d,t.y),t.z);
}
float volumeNoise(vec3 p) {
  return (noise3D(p)+.5*noise3D(p*2.03+vec3(17.1,9.2,5.7))
    +.25*noise3D(p*4.07+vec3(3.4,19.8,11.6)))/1.75;
}
`;
