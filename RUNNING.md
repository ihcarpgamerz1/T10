# Deploying T10 Showdown

Vercel serves the public site and runs the protected backend API as serverless Node.js Functions. PostgreSQL stores tournament data, admin sessions, and login-attempt limits. There is no local Node.js web server; connect this Git repository to Vercel and use the deployment URL.

## Automatic Vercel deployments

This project is configured for the repository root in Vercel. The root `api/` entry points forward to the implementation in `backend/`, so Vercel deploys the frontend and backend together from the same commit.

With the Git repository connected to the Vercel project, pushes to its configured production branch trigger a production deployment automatically; pull requests create preview deployments. No separate backend upload is needed. Vercel runs `npm run vercel-build` to validate the code before deployment.

## Configure Vercel

1. Create a Neon PostgreSQL project and copy its pooled connection string.
2. In Vercel **Project Settings → Environment Variables**, set `DATABASE_URL` and `T10_ADMIN_PASSWORD` for Production and any Preview/Development environments you will use. Use a strong admin password of at least 8 characters. Never put credentials in source files or frontend variables.
3. Ensure the Vercel project's Git settings point to this repository, use the repository root as the project root, and select the intended production branch. Do not set a separate output directory or build command; the `vercel-build` script performs validation.
4. Deploy once from Vercel or push a commit to the connected production branch. Subsequent pushes and pull requests deploy automatically.
5. If you have local results in the ignored `backend/data/state.json` file, import them before serving production traffic. The file is not deployed with Git. With the file available in a trusted development environment, enter the Neon connection string without echoing it, then run:

   ```sh
   read -rsp "Neon connection string: " DATABASE_URL; echo
   export DATABASE_URL
   npm run import:state
   unset DATABASE_URL
   ```

   The importer only fills an empty database or replaces the untouched tracked seed; it refuses to overwrite different database results. Keep the local state file as a backup.

The first API invocation creates the required PostgreSQL tables and seeds an empty database from `backend/data/initial-state.json`. Vercel's filesystem and process memory are not durable; all changes are stored in PostgreSQL.

In the admin panel, **Manage Names** lets officials rename tournament players and edit, add, or remove organizing committee members. Player count stays fixed at eight; renaming updates saved bracket results without clearing them.

## Presentation mode

On the tournament page, select **Presentation Mode** to start the show. The bracket stays incomplete until playback reaches each match: the active match is revealed and scrolled into view, with a pause to view the tree, then its player introduction, full-screen chess animation, and result play to completion before the next match begins. Connectors appear as their source matches have been revealed. An unconfirmed final stays pending; no champion is announced until an official result is saved. A confirmed champion receives a congratulations reveal. Select **Exit Presentation Mode** to stop the sequence. **Watch Tournament Replay** plays the match sequence without progressively revealing the bracket.

Select **Banner** in the navigation to open the full-screen artwork viewer. Switch between the tournament banner and Grand Final poster there; the selection is remembered in the browser. Use **Enter fullscreen** for the browser's native fullscreen mode, and close the viewer with its button or Escape. The previous-champion record lists Sahaj Shrestha as the winner of the Sahashrista tournament.

The public page also includes a two-player chess-clock demo and certificates. Selecting the Chief Guest or Chief Referee card opens the supplied certificate for Mr. Suman Shrestha or Mr. Sonu Das; the artwork stays hidden until selected. Once results are confirmed, the placement certificate buttons open matching T10 cream-and-gold SVG certificates for each player, with download and print/Save-as-PDF options. The organizing committee is listed at the end of the public page and in the protected admin panel. Saving a changed match result updates its downstream bracket slots and clears any results that are no longer valid.

For local code validation, run `npm run check` (requires Node.js). To see the live application, use the Vercel deployment URL rather than opening `index.html` or using Live Server.
