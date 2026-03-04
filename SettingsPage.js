import React, { useState } from 'react';
import styles from './SettingsPage.module.css';
import { AppearanceSettings } from '../../AppearanceSettings';
import { AccessibilitySettings } from './AccessibilitySettings';
import { BehaviorSettings } from './BehaviorSettings';
import { PrivacySettings } from './PrivacySettings';

const TABS = {
  appearance: { label: 'Görünüm', component: AppearanceSettings },
  accessibility: { label: 'Erişilebilirlik', component: AccessibilitySettings },
  behavior: { label: 'Davranış', component: BehaviorSettings },
  privacy: { label: 'Gizlilik', component: PrivacySettings },
};

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('appearance');
  const ActiveComponent = TABS[activeTab].component;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.pageTitle}>Ayarlar</h1>
      </header>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <nav>
            {Object.entries(TABS).map(([key, { label }]) => (
              <button
                key={key}
                className={`${styles.navButton} ${activeTab === key ? styles.active : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>
        <main className={styles.content}>
          <ActiveComponent />
        </main>
      </div>
    </div>
  );
}