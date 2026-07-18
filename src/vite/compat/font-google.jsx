const font = (options = {}) => ({
  className: options.className || '',
  style: options.style || {},
  variable: options.variable || '',
});

export const Inter = font;
export const Geist = font;
export const Geist_Mono = font;
export const Roboto = font;
export const Noto_Sans = font;
export const Noto_Sans_SC = font;
export const DM_Sans = font;
export default font;
