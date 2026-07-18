import { useEffect } from 'react';

function ExternalScript({ src }) {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    document.head.appendChild(script);
    return () => script.remove();
  }, [src]);
  return null;
}

export function GoogleAnalytics({ gaId }) {
  return gaId ? <ExternalScript src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} /> : null;
}

export function GoogleTagManager({ gtmId }) {
  return gtmId ? <ExternalScript src={`https://www.googletagmanager.com/gtm.js?id=${gtmId}`} /> : null;
}
