import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';

const STORAGE_KEY = 'app_ui_preferences';

const isObject = (item) => (item && typeof item === 'object' && !Array.isArray(item));

const deepMerge = (target, source) => {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) Object.assign(output, { [key]: source[key] });
        else output[key] = deepMerge(target[key], source[key]);
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
};

const defaultPrefs = {
  appearance: { theme: 'light', fontFamily: 'sans', fontSize: 'medium', lineHeight: 'comfortable', sidebarDensity: 'wide', reduceMotion: false },
  accessibility: { highContrast: false, keyboardShortcutsVisible: false, colorblindFriendly: false },
  behavior: { defaultMode: 'chat', autoShowSourcePanel: true, responseLanguage: 'tr-TR', responseFormat: 'detailed' },
  privacy: { saveHistory: true, filePreviewBehavior: 'inline', autoSessionTimeout: 30 }
};

function getStoredPrefs() {
  if (typeof window === 'undefined') return defaultPrefs;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return deepMerge(defaultPrefs, parsed);
    }
  } catch (error) {
    console.error("Error reading UI preferences, falling back to defaults.", error);
  }
  return defaultPrefs;
}

const UIPrefsContext = createContext(null);

export function UIPrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(getStoredPrefs);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      } catch (error) {
        console.error("Error saving UI preferences.", error);
      }
    }
  }, [prefs]);

  useEffect(() => {
    const root = document.documentElement;
    const { appearance, accessibility } = prefs;
    
    root.setAttribute('data-theme', appearance.theme);
    root.setAttribute('data-font-family', appearance.fontFamily);
    root.setAttribute('data-font-size', appearance.fontSize);
    root.setAttribute('data-line-height', appearance.lineHeight);
    root.setAttribute('data-sidebar-density', appearance.sidebarDensity);
    root.setAttribute('data-reduce-motion', appearance.reduceMotion);
    root.setAttribute('data-high-contrast', accessibility.highContrast);
    root.setAttribute('data-colorblind-friendly', accessibility.colorblindFriendly);

  }, [prefs]);

  const updatePref = useCallback((category, key, value) => {
    setPrefs(currentPrefs => ({
      ...currentPrefs,
      [category]: {
        ...currentPrefs[category],
        [key]: value,
      },
    }));
  }, []);

  return (
    <UIPrefsContext.Provider value={{ prefs, updatePref }}>
      {children}
    </UIPrefsContext.Provider>
  );
}

export const useUIPrefs = () => {
  const context = useContext(UIPrefsContext);
  if (!context) {
    throw new Error('useUIPrefs must be used within a UIPrefsProvider');
  }
  return context;
};