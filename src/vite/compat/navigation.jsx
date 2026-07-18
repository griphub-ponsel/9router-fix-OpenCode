import { useLocation, useNavigate, useParams as useRouterParams, useSearchParams as useRouterSearchParams } from 'react-router-dom';

export class NavigationSignal extends Error {
  constructor(kind, destination, replace = false) {
    super(kind);
    this.kind = kind;
    this.destination = destination;
    this.replace = replace;
  }
}

export const RedirectType = { push: 'push', replace: 'replace' };

export function redirect(destination, type = RedirectType.replace) {
  throw new NavigationSignal('redirect', destination, type === RedirectType.replace);
}

export function permanentRedirect(destination) {
  throw new NavigationSignal('redirect', destination, true);
}

export function notFound() {
  throw new NavigationSignal('not-found');
}

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (href, options) => navigate(href, { state: options?.state }),
    replace: (href, options) => navigate(href, { replace: true, state: options?.state }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => window.location.reload(),
    prefetch: async () => undefined,
  };
}

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  return useRouterSearchParams()[0];
}

export function useParams() {
  return useRouterParams();
}

export function useSelectedLayoutSegment() {
  return usePathname().split('/').filter(Boolean).at(-1) || null;
}

export function useSelectedLayoutSegments() {
  return usePathname().split('/').filter(Boolean);
}
