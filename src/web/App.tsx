import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { createQueryClient } from './data/hooks';
import { LanguageProvider } from './i18n';
import { routes } from './routes';
import { ThemeProvider } from './theme/ThemeProvider';

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
