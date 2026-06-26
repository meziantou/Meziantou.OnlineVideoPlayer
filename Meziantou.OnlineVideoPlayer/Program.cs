#pragma warning disable CA1848 // Use the LoggerMessage delegates
using Meziantou.OnlineVideoPlayer;
using Meziantou.OnlineVideoPlayer.Pages;
using Meziantou.AspNetCore.ServiceDefaults;
using Meziantou.Framework;
using Microsoft.Extensions.Options;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
builder.UseMeziantouConventions(options =>
{
    options.ConfigureJsonOptions = options => options.TypeInfoResolverChain.Insert(0, CustomJsonSerializationContext.Default);
});
builder.Services.AddRazorComponents();

builder.Services.Configure<PlayerConfiguration>(builder.Configuration.GetSection("PlayerConfiguration"));

var app = builder.Build();
app.MapRazorComponents<App>();

app.MapGet("playlists", (HttpContext context, IOptions<PlayerConfiguration> options) =>
{
    var result = new List<string>();
    foreach (var file in Directory.EnumerateFiles(options.Value.RootFolderReadOnly, "*", SearchOption.TopDirectoryOnly).Select(FullPath.FromPath))
    {
        if (file.Extension is ".m3u" or ".m3u8")
        {
            result.Add(file.Name);
        }
    }

    return Results.Json(result, CustomJsonSerializationContext.Default.ListString);
});

app.MapGet("playlists/{Id}/tracks", async (HttpContext context, string id, IOptions<PlayerConfiguration> options) =>
{
    var lines = await File.ReadAllLinesAsync(Path.Combine(options.Value.RootFolderReadOnly, id), context.RequestAborted);
    return Results.Json(lines.Where(line => !string.IsNullOrEmpty(line)).Select(line => options.Value.GetShortPath(line)), CustomJsonSerializationContext.Default.IEnumerableString);
});

app.MapGet("files/{**path}", (HttpContext context, string path, IOptions<PlayerConfiguration> options) =>
{
    var fullPath = GetFullPath(path, options, writeAccess: false);
    return Results.File(fullPath, enableRangeProcessing: true);
});

app.MapGet("file-details/{**path}", (string path, IOptions<PlayerConfiguration> options) =>
{
    var fullPath = GetFullPath(path, options, writeAccess: false);
    var details = new FileDetails(new FileInfo(fullPath).Length);
    return Results.Json(details, CustomJsonSerializationContext.Default.FileDetails);
});

app.MapDelete("files/{**path}", (HttpContext context, ILogger<Program> logger, string path, IOptions<PlayerConfiguration> options) =>
{
    var fullPath = GetFullPath(path, options, writeAccess: true);
    try
    {
        File.Delete(fullPath);
        return Results.Ok();
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to delete file: {Path}", fullPath);
        return Results.Problem(ex.Message);
    }
});

await app.RunAsync();

static string GetFullPath(string path, IOptions<PlayerConfiguration> options, bool writeAccess)
{
    var root = writeAccess ? options.Value.RootFolderReadWrite : options.Value.RootFolderReadOnly;
    path = path.Replace("%2f", "/", StringComparison.OrdinalIgnoreCase);
    var fullPath = Path.Combine(root, path);
    if (File.Exists(fullPath))
        return fullPath;

    foreach (var probe in options.Value.ProbePaths)
    {
        fullPath = Path.Combine(root, probe, path);
        if (File.Exists(fullPath))
            return fullPath;
    }

    var normalizedPath = NormalizePath(path);
    foreach (var searchRoot in GetSearchRoots(root, options.Value.ProbePaths))
    {
        var found = TryFindFileByNormalizedRelativePath(searchRoot, normalizedPath);
        if (found is not null)
            return found;
    }

    throw new InvalidOperationException("File not found: " + path);
}

static IEnumerable<string> GetSearchRoots(string root, IEnumerable<string> probePaths)
{
    yield return root;

    foreach (var probe in probePaths)
        yield return Path.Combine(root, probe);
}

static string? TryFindFileByNormalizedRelativePath(string searchRoot, string normalizedPath)
{
    if (!Directory.Exists(searchRoot))
        return null;

    foreach (var file in Directory.EnumerateFiles(searchRoot, "*", SearchOption.AllDirectories))
    {
        var relativePath = Path.GetRelativePath(searchRoot, file);
        if (NormalizePath(relativePath) == normalizedPath)
        {
            return file;
        }
    }

    return null;
}

static string NormalizePath(string value)
{
    return value.Replace('\\', '/').Normalize(NormalizationForm.FormC);
}
