// language=GLSL
export const liquidFragSource = /* glsl */ `#version 300 es
precision mediump float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D u_image_texture;
uniform float u_time;
uniform float u_imageAspectRatio;

uniform float u_customParam;

vec2 get_img_uv() {
  vec2 img_uv = vUv;
  img_uv -= .5;
  if (1. > u_imageAspectRatio) {
    img_uv.x = img_uv.x / u_imageAspectRatio;
  } else {
    img_uv.y = img_uv.y * u_imageAspectRatio;
  }
  img_uv += .5;

  img_uv.y = 1. - img_uv.y;

  return img_uv;
}

void main() {
  vec2 uv = vUv;
  uv.y = 1. - uv.y;

  float t = .005 * u_time;
  
  vec2 img_uv = get_img_uv();
  vec4 img = texture(u_image_texture, img_uv);

  img.g = u_customParam;
  img.b = sin(t) * img.r;

  fragColor = img;
}
`;
