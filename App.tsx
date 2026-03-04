import React from 'react';
import SettingsPage from './SettingsPage';
import Sidebar from './Sidebar';
import { ThemeSettingsProvider } from './components/theme/theme-settings-provider';
import './App.css'; // Ana layout için stil dosyasını import ediyoruz

// Uygulamanın ana iskeleti (App Shell)
// Artık bir placeholder değil, çalışan bir layout.
const MainApplicationLayout = () => {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-content">
        {/* 
          Burası, uygulamanızın ana içerik alanıdır.
          Mevcut router'ınız (<Routes>) burada yer almalıdır.
          Şimdilik, Ayarlar sayfasını ana içerik olarak gösteriyoruz.
        */}
        <div className="app-content__inner">
          <SettingsPage />
        </div>
      </main>
    </div>
  );
};

function App() {
  return (
    <ThemeSettingsProvider>
      <MainApplicationLayout />
    </ThemeSettingsProvider>
  );
}

export default App;