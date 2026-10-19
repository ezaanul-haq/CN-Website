import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/Home';
import Intro from '@/pages/Intro';
import Videos from '@/pages/Videos';
import Topic from '@/pages/Topic';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({defaultOptions:{queries:{retry:1,staleTime:30_000}}});

function Router() {
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={Intro}/>
    <Route path="/notes" component={Home}/>
    <Route path="/videos" component={Videos}/>
    <Route path="/topic/:topicId" component={Topic}/>
    <Route component={NotFound}/>
  </Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Router/>
    </WouterRouter><Toaster/></TooltipProvider>
  </QueryClientProvider>;
}

export default App;
