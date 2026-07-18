import { useEffect, useRef } from 'react';

export default function Script({ src, strategy: _strategy, onLoad, onError, dangerouslySetInnerHTML, children, ...props }) {
  const configuration = useRef({ onLoad, onError, dangerouslySetInnerHTML, children, props });

  useEffect(() => {
    const current = configuration.current;
    const script = document.createElement('script');
    if (src) script.src = src;
    Object.entries(current.props).forEach(([key, value]) => {
      if (value != null && typeof value !== 'function') script.setAttribute(key, String(value));
    });
    if (current.dangerouslySetInnerHTML) script.text = current.dangerouslySetInnerHTML.__html;
    if (current.children) script.text = current.children;
    script.onload = current.onLoad;
    script.onerror = current.onError;
    document.head.appendChild(script);
    return () => script.remove();
  }, [src]);
  return null;
}
