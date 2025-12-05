import React from "react";

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
   

      <main className="flex flex-1 flex-col">
        <div className="flex-1">{children}</div>
      </main>
  );
}
