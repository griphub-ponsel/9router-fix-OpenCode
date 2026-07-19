import React, { forwardRef, startTransition } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';

const Link = forwardRef(({ href, children, replace, scroll: _scroll, prefetch: _prefetch, onClick, state, target, ...props }, ref) => {
  const navigate = useNavigate();
  const isExternal = typeof href === 'string' && /^(?:[a-z]+:)?\/\//i.test(href);
  if (isExternal) return <a ref={ref} href={href} onClick={onClick} target={target} {...props}>{children}</a>;

  const handleClick = (event) => {
    onClick?.(event);
    if (event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || (target && target !== '_self')) return;

    event.preventDefault();
    startTransition(() => navigate(href || '/', { replace, state }));
  };

  return (
    <RouterLink ref={ref} to={href || '/'} replace={replace} state={state} target={target} onClick={handleClick} {...props}>
      {children}
    </RouterLink>
  );
});

Link.displayName = 'Link';
export default Link;
