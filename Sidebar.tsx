import React from 'react';
import './Sidebar.css';

const Sidebar: React.FC = () => {
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__logo">Hukuk Asistanı</div>
      </div>
      <nav className="sidebar__nav">
        <a href="#" className="sidebar__nav-item active">
          {/* Icon placeholder */}
          <span>Sohbet</span>
        </a>
        <a href="#" className="sidebar__nav-item">
          {/* Icon placeholder */}
          <span>Belge İnceleme</span>
        </a>
        <a href="#" className="sidebar__nav-item">
          {/* Icon placeholder */}
          <span>Araştırma</span>
        </a>
        <a href="#" className="sidebar__nav-item">
          {/* Icon placeholder */}
          <span>Ayarlar</span>
        </a>
      </nav>
    </aside>
  );
};

export default Sidebar;