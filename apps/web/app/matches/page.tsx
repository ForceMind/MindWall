"use client";

import { useEffect } from 'react';
import { AppLoadingScreen } from '../../components/app-shell';

export default function LegacyMatchesPage() {
  useEffect(() => {
    window.location.replace('/contacts');
  }, []);

  return <AppLoadingScreen label="正在跳转到联系人..." />;
}
