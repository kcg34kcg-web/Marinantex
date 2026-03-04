import React from 'react';
import './Card.css';

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

const Card: React.FC<CardProps> = ({ children, className = '' }) => {
  // Combines a base class with any additional classes passed in.
  const cardClasses = `card ${className}`;
  return <div className={cardClasses}>{children}</div>;
};

export default Card;