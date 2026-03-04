import React from 'react';
import './Input.css';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

const Input: React.FC<InputProps> = ({ className = '', ...props }) => {
  const inputClasses = `input ${className}`;
  return <input className={inputClasses} {...props} />;
};

export default Input;