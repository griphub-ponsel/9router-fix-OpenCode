import { Component, Suspense, lazy, useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { NavigationSignal } from './compat/navigation.jsx';
import { pagePathToRoute, sortRoutes } from './route-utils.js';

const pages = import.meta.glob('/src/app/**/page.js');
const layouts = import.meta.glob('/src/app/**/layout.js');

function loadDefault(loader) {
  return lazy(async () => {
    const loadedModule = await loader();
    return { default: loadedModule.default };
  });
}

const dashboardLayoutLoader = layouts['/src/app/(dashboard)/layout.js'];
const DashboardLayout = dashboardLayoutLoader
  ? loadDefault(dashboardLayoutLoader)
  : ({ children }) => children;

const routeEntries = sortRoutes(Object.keys(pages).map(pagePathToRoute)).map((route) => ({
  route,
  Page: loadDefault(pages[Object.keys(pages).find((path) => pagePathToRoute(path) === route)]),
}));

function RouteError({ error }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (error instanceof NavigationSignal && error.kind === 'redirect') {
      navigate(error.destination, { replace: error.replace });
    }
  }, [error, navigate]);

  if (error instanceof NavigationSignal && error.kind === 'not-found') {
    return <main>Not Found</main>;
  }

  if (error instanceof NavigationSignal) return null;

  return (
    <main role="alert">
      <h1>Something went wrong</h1>
      <pre>{error.message}</pre>
    </main>
  );
}

class RouteBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (previousProps.locationKey !== this.props.locationKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    return this.state.error ? <RouteError error={this.state.error} /> : this.props.children;
  }
}

function RoutedPage({ Page, dashboard }) {
  const routeParams = useParams();
  const [searchParams] = useSearchParams();
  const content = <Page params={Promise.resolve(routeParams)} searchParams={Promise.resolve(searchParams)} />;
  return dashboard ? <DashboardLayout>{content}</DashboardLayout> : content;
}

export default function App() {
  const location = useLocation();

  return (
    <RouteBoundary locationKey={location.key}>
      <Suspense fallback={<main>Loading...</main>}>
        <Routes>
          {routeEntries.map(({ route, Page }) => (
            <Route
              key={route}
              path={route}
              element={<RoutedPage key={route} Page={Page} dashboard={route === '/dashboard' || route.startsWith('/dashboard/')} />}
            />
          ))}
          <Route path="*" element={<main>Not Found</main>} />
        </Routes>
      </Suspense>
    </RouteBoundary>
  );
}
