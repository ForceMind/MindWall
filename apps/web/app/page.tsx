export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-20 font-sans">
      <main className="w-full max-w-3xl rounded-3xl border border-zinc-200 bg-white p-10 shadow-sm md:p-14">
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-sm font-medium tracking-[0.2em] text-zinc-500">
              MINDWALL | 心垣
            </p>
            <h1 className="text-3xl font-semibold leading-tight text-zinc-900 md:text-4xl">
              AI 中介的零信任社交沙盒
            </h1>
            <p className="text-base leading-7 text-zinc-600">
              你现在看到的是中文默认界面。下一阶段将实现 AI 灵魂镜入场、匹配引擎与沙盒聊天。
            </p>
          </div>
          <div className="grid gap-4 rounded-2xl bg-zinc-100 p-5 text-sm text-zinc-700 md:grid-cols-3">
            <div>
              <p className="font-semibold text-zinc-900">阶段 1</p>
              <p>项目初始化与数据库建模</p>
            </div>
            <div>
              <p className="font-semibold text-zinc-900">阶段 2</p>
              <p>AI 入场访谈与标签生成</p>
            </div>
            <div>
              <p className="font-semibold text-zinc-900">阶段 3+</p>
              <p>匹配引擎与沙盒聊天流程</p>
            </div>
          </div>
          <p className="text-sm text-zinc-500">
            本地启动请执行：`scripts/start-local.ps1`
          </p>
        </div>
      </main>
    </div>
  );
}
