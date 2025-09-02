export type ShaderParams = {
  customParam: number;
  speed: number;
};

export const params = {
  customParam: {
    min: 0,
    max: 1,
    step: 0.001,
    default: 0,
  },
  speed: {
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.3,
  },
};

/** The default params for the shader in a ShaderParams object */
export const defaultParams: ShaderParams = Object.fromEntries(
  Object.entries(params).map(([key, value]) => [key, value.default])
) as ShaderParams;
