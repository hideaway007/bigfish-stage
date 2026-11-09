import React from 'react';
import ReactDOM from 'react-dom/client';
import { StageApp } from './stage/StageApp';
import './stage/stage.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StageApp />
  </React.StrictMode>
);
