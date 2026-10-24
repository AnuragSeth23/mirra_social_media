import { BackButton } from './BackButton';
import { ThemeToggle } from './ui';

/** Split layout: the logo with its reflection and one clear line on one side, the form on the other. Stacks on small screens. */
export function AuthShell({ children, footer, back }) {
  return (
    <div className="auth">
      <aside className="pool" aria-label="About SocialAmbak">
        <div className="pool-sky">
          <span className="pool-word">SocialAmbak</span>
        </div>
        <div className="pool-water">
          <span className="pool-word pool-reflection" aria-hidden>
            SocialAmbak
          </span>
          <p className="pool-line">Connect with friends and the world around you on SocialAmbak.</p>
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-top">
          {back ? typeof back === 'string' ? <BackButton to={back} /> : <BackButton onClick={back} /> : <span />}
          <ThemeToggle />
        </div>
        <div className="auth-body">{children}</div>
        {footer && <div className="auth-footer">{footer}</div>}
      </main>
    </div>
  );
}
