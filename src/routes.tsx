import { createBrowserRouter, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import RouteErrorPage from './components/shared/RouteErrorPage';
import RouteLoading from './components/shared/RouteLoading';

export const router = createBrowserRouter([
  {
    path: 'terms',
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <RouteLoading />,
    lazy: async () => ({
      Component: (await import('./components/marketing/TermsPage')).default,
    }),
  },
  {
    path: 'privacy',
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <RouteLoading />,
    lazy: async () => ({
      Component: (await import('./components/marketing/PrivacyPage')).default,
    }),
  },
  {
    path: '/',
    element: <MainLayout />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <RouteLoading />,
    children: [
      {
        index: true,
        element: <Navigate to="/workspace" replace />,
      },
      {
        path: 'workspace',
        lazy: async () => ({
          Component: (await import('./components/workspace/WorkspacePage')).default,
        }),
      },
      {
        path: 'workspace/analysis-archive',
        lazy: async () => ({
          Component: (await import('./components/workspace/AnalysisArchive/AnalysisArchive'))
            .default,
        }),
      },
      {
        path: 'workspace/analysis-archive/:analysisId',
        lazy: async () => ({
          Component: (await import('./components/workspace/AnalysisArchive/AnalysisArchive'))
            .default,
        }),
      },
      {
        path: 'workspace/mapping-studio',
        lazy: async () => ({
          Component: (await import('./components/mapping-studio/MappingStudioPage')).default,
        }),
      },
      {
        path: 'workspace/mapping-studio/:mappingId/:version',
        lazy: async () => ({
          Component: (await import('./components/mapping-studio/MappingStudioPage')).default,
        }),
      },
      {
        path: 'workspace/fiscal-package',
        lazy: async () => ({
          Component: (
            await import('./components/mapping-studio/FiscalPackageWizard/FiscalPackageWizard')
          ).default,
        }),
      },
      {
        path: 'workspace/field-correction-curation',
        lazy: async () => ({
          Component: (
            await import('./components/workspace/FieldCorrectionCuration/FieldCorrectionCuration')
          ).default,
        }),
      },
      {
        path: 'upload',
        lazy: async () => ({
          Component: (await import('./components/layout/LayoutParserPage')).default,
        }),
      },
      {
        path: 'analysis',
        lazy: async () => ({
          Component: (await import('./components/layout/LayoutParserPage')).default,
        }),
      },
      {
        path: 'admin',
        lazy: async () => ({
          Component: (await import('./components/auth/AdminRoute')).default,
        }),
      },
    ],
  },
]);
