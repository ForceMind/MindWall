"use client";

import { useEffect } from 'react';
import { AppLoadingScreen } from '../../components/app-shell';

export default function LegacyCompanionPage() {
  useEffect(() => {
    window.location.replace('/chat');
  }, []);

  return <AppLoadingScreen label="正在跳转到聊天..." />;
}
