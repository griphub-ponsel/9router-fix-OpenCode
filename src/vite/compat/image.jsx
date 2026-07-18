import { forwardRef } from 'react';

const Image = forwardRef(({ src, alt = '', fill, priority: _priority, placeholder: _placeholder, blurDataURL: _blurDataURL, loader, unoptimized: _unoptimized, style, ...props }, ref) => {
  const resolvedSrc = typeof src === 'object' ? src.src : src;
  return <img ref={ref} src={loader ? loader({ src: resolvedSrc, width: props.width, quality: props.quality }) : resolvedSrc} alt={alt} style={fill ? { position: 'absolute', width: '100%', height: '100%', inset: 0, ...style } : style} {...props} />;
});

Image.displayName = 'Image';
export default Image;
