# Open43 settings source residual seam referents

<table>
  <thead>
    <tr>
      <th>ID</th>
      <th>Established referent</th>
      <th>Role</th>
      <th>Independent authority</th>
      <th>Chosen term</th>
      <th>Excluded interpretation</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>R610P</td>
      <td>The HTML returned by the public PagePreview endpoint for exact authored source <code>[[a href="##"]]Close[[/a]]</code></td>
      <td>Prove fragment-only double-hash ownership before any saved revision exists</td>
      <td>Issue 610 acceptance input and the frozen live browser observation that the sidebar closer has one exact <code>href="##"</code></td>
      <td>preview fragment href</td>
      <td>A private render helper result or post-render string rewrite</td>
    </tr>
    <tr>
      <td>R610N</td>
      <td>The side-bar HTML returned by public <code>page_view</code> after saving that source in <code>nav:side</code> and rerendering its dependent page</td>
      <td>Prove saved navigation dependency compilation uses the latest revision and preserves the same authored attribute</td>
      <td>The same Issue 610 and frozen live observation, plus the repository's existing navigation dependency rerender contract</td>
      <td>saved navigation fragment href</td>
      <td>A direct database or text-block assertion that bypasses the served page view</td>
    </tr>
    <tr>
      <td>RSETX</td>
      <td>A repository-owned public representation that serializes site state and can later reconstruct it</td>
      <td>Provide the producer and consumer needed for an actual site settings round trip</td>
      <td>The requested #754 and #1046 acceptance rows, checked against the repository source inventory</td>
      <td>site settings export boundary</td>
      <td>The fixture seeder or the one-way Wikidot corpus import service</td>
    </tr>
    <tr>
      <td>RSETR</td>
      <td>The format and conflict policy that preserve same-site settings identity and revision while preventing cross-site copying</td>
      <td>Define independently checkable analytics, welcome-page, identity, and revision expectations for import</td>
      <td>The requested acceptance rows; the frozen site-backup specification supplies no settings format or revision semantics</td>
      <td>settings restore policy</td>
      <td>Invented defaults, seeder behavior, or direct model serialization</td>
    </tr>
  </tbody>
</table>
