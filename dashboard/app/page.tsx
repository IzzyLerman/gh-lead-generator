import { fetchCompaniesWithContactsAndPhotos } from '@/lib/server-utils'
import CompaniesTable from '@/components/CompaniesTable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ThemeToggle } from '@/components/ui/theme-toggle'

export default async function Dashboard() {
  const paginatedCompanies = await fetchCompaniesWithContactsAndPhotos({ page: 1, pageSize: 6 })

  return (
    <div className="flex-1 bg-gray-50 dark:bg-background">
      <div className="container mx-auto py-8 px-4">
        <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">GH Lead Generator Dashboard</h1>
              <p className="text-muted-foreground">
                Submit Truck Images and Track Lead Progress
              </p>
            </div>
            <ThemeToggle />
          </div>
        </div>
       
        {/* Total cards -- removed but maybe I'll add it back
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Companies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{companies.length}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Active Leads</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {companies.filter(c => c.status === 'enriching').length}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Contacts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {companies.reduce((sum, company) => sum + company.contacts.length, 0)}
              </div>
            </CardContent>
          </Card>
        </div>
	*/}
	

        <Card>
          <CardHeader>
            <CardTitle>Companies & Contacts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <CompaniesTable initialData={paginatedCompanies} />
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  )
}
