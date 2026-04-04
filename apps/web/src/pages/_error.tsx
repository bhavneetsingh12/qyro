import type { NextPageContext } from "next";

function ErrorPage({ statusCode }: { statusCode: number }) {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>{statusCode} – {statusCode === 404 ? "Page Not Found" : "An error occurred"}</h1>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode ?? 500 : 404;
  return { statusCode };
};

export default ErrorPage;
