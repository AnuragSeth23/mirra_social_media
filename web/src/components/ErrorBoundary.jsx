import { Component } from 'react';

/** If a screen crashes, show a calm message with a way out instead of a blank page. */
export class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    console.error('[ui crash]', error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="splash" role="alert">
        <div className="empty crash">
          <h2>Something went wrong</h2>
          <p>The page hit a problem. Your data is safe.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              location.href = '/';
            }}
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }
}
