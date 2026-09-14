import { RouterProvider } from 'react-router-dom';
import { router } from './Router';

function App() {
  return (
    <div className="w-screen h-screen overflow-hidden overscroll-none">
      <RouterProvider router={router} />
    </div>
  );
}

export default App;
