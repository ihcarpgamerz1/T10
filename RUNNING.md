# Running T10 Showdown

The site and its protected admin panel are served by the same Node.js server. No npm packages are required.

## Start locally

From the project directory, run:

```sh
npm start
```

Then open:

- Tournament site: <http://localhost:3000/>
- Admin sign-in: <http://localhost:3000/admin>

For local development, the admin password is `T10ADMIN`. The server starts with this password by default, and verifies it on the server (it is not in browser code). Do not use the development password on a public deployment: set `T10_ADMIN_PASSWORD` in the hosting provider's secret/environment settings and set `NODE_ENV=production` before starting. The server requires an explicit password in production. Match results are saved in `data/state.json`; that file is created by the server and is excluded from Git.

In VS Code, you can also run **Terminal → Run Task → Start T10 Showdown server**.

Do not use Live Server or open `index.html` directly; those do not run the backend needed for sign-in and saving results.

## Presentation mode

On the tournament page, select **Presentation Mode** to start the show. The bracket stays incomplete until playback reaches each match: the active match is revealed and scrolled into view, with a pause to view the tree, then its player introduction, full-screen chess animation, and result play to completion before the next match begins. Connectors appear as their source matches have been revealed. An unconfirmed final stays pending; no champion is announced until an official result is saved. A confirmed champion receives a congratulations reveal. Select **Exit Presentation Mode** to stop the sequence. **Watch Tournament Replay** plays the match sequence without progressively revealing the bracket.

Select **Banner** in the navigation to open the full-screen artwork viewer. Switch between the tournament banner and Grand Final poster there; the selection is remembered in the browser. Use **Enter fullscreen** for the browser's native fullscreen mode, and close the viewer with its button or Escape. The previous-champion record lists Sahaj Shrestha as the winner of the Sahashrista tournament.

The public page also includes a two-player chess-clock demo and certificates. Selecting the Chief Guest or Chief Referee card opens the supplied certificate for Mr. Suman Shrestha or Mr. Sonu Das; the artwork stays hidden until selected. Once results are confirmed, the placement certificate buttons open matching T10 cream-and-gold SVG certificates for each player, with download and print/Save-as-PDF options. The organizing committee is listed at the end of the public page and in the protected admin panel. Saving a changed match result updates its downstream bracket slots and clears any results that are no longer valid.

On PowerShell, you can override the local password before starting:

```powershell
$env:T10_ADMIN_PASSWORD = "T10ADMIN"
npm start
```
