import { login } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginThemeController } from '@/components/ui/login-theme-controller'
import Image from 'next/image'

export default function LoginPage() {
  return (
    <>
      <LoginThemeController />
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex items-center justify-center">
            <Image 
              src="/gh-logo.png" 
              alt="GH Lead Generator Logo" 
              width={640} 
              height={640}
              className="rounded"
              style={{ width: '200px', height: '129px' }}
            />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">GH Lead Generator</CardTitle>
            <CardDescription className="text-slate-600">
              Enter the password to access the dashboard
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-slate-700">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Enter your password"
                required
                className="w-full"
              />
            </div>
            <Button formAction={login} className="w-full h-11 text-base font-medium">
              Sign In
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
    </>
  )
}
