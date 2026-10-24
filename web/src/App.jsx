import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Wordmark } from './components/ui';
import { Home } from './pages/Home';
import { Chat } from './pages/Chat';
import { ForgotPassword } from './pages/ForgotPassword';
import { Messages } from './pages/Messages';
import { NotFound } from './pages/NotFound';
import { Notifications } from './pages/Notifications';
import { PostPage } from './pages/PostPage';
import { ProfilePage } from './pages/ProfilePage';
import { Reels } from './pages/Reels';
import { Search } from './pages/Search';
import { Settings } from './pages/Settings';
import { TagPage } from './pages/TagPage';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { Verify } from './pages/Verify';

function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading SocialAmbak">
      <Wordmark />
    </div>
  );
}

function SignedIn({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <Splash />;
  return status === 'signedIn' ? <>{children}</> : <Navigate to="/signin" replace />;
}

function SignedOut({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <Splash />;
  return status === 'signedOut' ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <SignedIn>
            <Home />
          </SignedIn>
        }
      />
      <Route
        path="/post/:id"
        element={
          <SignedIn>
            <PostPage />
          </SignedIn>
        }
      />
      <Route
        path="/u/:username"
        element={
          <SignedIn>
            <ProfilePage />
          </SignedIn>
        }
      />
      <Route
        path="/forgot"
        element={
          <SignedOut>
            <ForgotPassword />
          </SignedOut>
        }
      />
      <Route
        path="/reels"
        element={
          <SignedIn>
            <Reels />
          </SignedIn>
        }
      />
      <Route
        path="/search"
        element={
          <SignedIn>
            <Search />
          </SignedIn>
        }
      />
      <Route
        path="/notifications"
        element={
          <SignedIn>
            <Notifications />
          </SignedIn>
        }
      />
      <Route
        path="/messages"
        element={
          <SignedIn>
            <Messages />
          </SignedIn>
        }
      />
      <Route
        path="/messages/:id"
        element={
          <SignedIn>
            <Chat />
          </SignedIn>
        }
      />
      <Route
        path="/settings"
        element={
          <SignedIn>
            <Settings />
          </SignedIn>
        }
      />
      <Route
        path="/signin"
        element={
          <SignedOut>
            <SignIn />
          </SignedOut>
        }
      />
      <Route
        path="/signup"
        element={
          <SignedOut>
            <SignUp />
          </SignedOut>
        }
      />
      <Route
        path="/verify"
        element={
          <SignedOut>
            <Verify />
          </SignedOut>
        }
      />
      <Route
        path="/tag/:tag"
        element={
          <SignedIn>
            <TagPage />
          </SignedIn>
        }
      />
      <Route
        path="*"
        element={
          <SignedIn>
            <NotFound />
          </SignedIn>
        }
      />
    </Routes>
  );
}
