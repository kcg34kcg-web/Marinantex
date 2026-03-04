import React from 'react';
import './Switch.css';

interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  // No new props needed for now, but we can extend it later
}

const Switch: React.FC<SwitchProps> = ({ className = '', ...props }) => {
  const switchClasses = `switch ${className}`;

  return (
    <label className={switchClasses}>
      <input type="checkbox" {...props} />
      <span className="switch__slider"></span>
    </label>
  );
};

export default Switch;