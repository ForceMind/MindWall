"use client";

import { useEffect } from 'react';
import { AppLoadingScreen } from '../components/app-shell';
import { fetchCurrentViewer } from '../lib/auth-client';

export default function HomePage() {
  useEffect(() => {
    async function bootstrap() {
      try {
        const viewer = await fetchCurrentViewer();
        if (viewer) {
          window.location.replace('/contacts');
          return;
        }
      } catch {
        // ignore
      }

      window.location.replace('/login');
    }

    void bootstrap();
  }, []);

  return <AppLoadingScreen label="正在进入心垣..." />;
}
