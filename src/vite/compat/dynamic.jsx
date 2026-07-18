import React, { lazy, Suspense } from 'react';

export default function dynamic(loader, options = {}) {
  const DynamicComponent = lazy(async () => {
    const loadedModule = await loader();
    return { default: loadedModule.default || loadedModule };
  });

  return function Dynamic(props) {
    const fallback = options.loading ? React.createElement(options.loading, props) : null;
    return <Suspense fallback={fallback}><DynamicComponent {...props} /></Suspense>;
  };
}
