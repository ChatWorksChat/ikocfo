import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="not-found">
      <h1>404</h1>
      <h2>Page Not Found</h2>
      <p>The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
      <Link to="/" className="btn btn-primary">
        Back to Home
      </Link>
    </div>
  );
}
