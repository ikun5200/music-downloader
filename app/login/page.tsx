import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/auth'
import { LoginClient } from '@/components/login-client'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await isAdmin()) redirect('/admin')
  return <LoginClient />
}
