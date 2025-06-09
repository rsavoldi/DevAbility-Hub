// src/app/(auth)/layout.tsx
import type { Metadata } from 'next';
import { AuthProvider } from '@/contexts/AuthContext'; // Para acesso ao contexto se necessário

export const metadata: Metadata = {
  title: 'Autenticação | DevAbility Hub',
  description: 'Acesse ou crie sua conta no DevAbility Hub.',
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider> {/* AuthProvider aqui para caso o layout de auth precise de contexto */}
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-primary/10 via-background to-secondary/10 p-4">
        <main className="w-full max-w-md">
          {children}
        </main>
        <footer className="mt-8 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} DevAbility Hub. Todos os direitos reservados.</p>
        </footer>
      </div>
    </AuthProvider>
  );
}
