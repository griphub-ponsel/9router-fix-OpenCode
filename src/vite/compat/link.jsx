import { forwardRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';

const Link = forwardRef(({ href, children, replace, scroll: _scroll, prefetch: _prefetch, ...props }, ref) => {
  const isExternal = typeof href === 'string' && /^(?:[a-z]+:)?\/\//i.test(href);
  if (isExternal) return <a ref={ref} href={href} {...props}>{children}</a>;
  return <RouterLink ref={ref} to={href || '/'} replace={replace} {...props}>{children}</RouterLink>;
});

Link.displayName = 'Link';
export default Link;
