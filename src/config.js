// Public configuration. The Supabase anon key is safe to ship to the browser —
// Row Level Security (see supabase/schema.sql) is what actually protects writes.
// Leave supabaseUrl/anonKey empty until the Supabase project exists; the site
// works fully without them (the admin layer just stays dormant).
export const CONFIG = {
  kmlUrl: 'https://www.google.com/maps/d/kml?mid=1oSzJorsXgSsXs6oWVNIJh3FgU2-xgWdU&forcekml=1',
  supabaseUrl: '',
  supabaseAnonKey: '',
  mediaBucket: 'marker-media',
};
