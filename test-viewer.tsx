import React, { useState } from 'react';
import { Viewer } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';

export function Test() {
  const [count, setCount] = useState(0);
  const layoutPlugin = defaultLayoutPlugin();
  
  return <Viewer fileUrl="test.pdf" plugins={[layoutPlugin]} />;
}
